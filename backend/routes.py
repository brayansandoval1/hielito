from flask import Blueprint, request, jsonify, send_from_directory
from backend import db, jwt
from backend.models import User, Product, Order, Payment, Category, OrderItem, Promotion, PromotionItem
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import stripe
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import traceback
import os

# Configurar Stripe
def get_google_client_id():
    # Intentamos obtenerlo de la variable global o directamente del entorno
    client_id = os.getenv('GOOGLE_CLIENT_ID')
    if not client_id:
        # Intento de respaldo por si el módulo se cargó antes que el .env
        from dotenv import load_dotenv
        load_dotenv()
        client_id = os.getenv('GOOGLE_CLIENT_ID')
    return client_id

# Blueprint de autenticación
auth = Blueprint('auth', __name__)

@auth.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Faltan datos'}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email ya registrado'}), 400

    hashed_password = generate_password_hash(data['password'], method='pbkdf2:sha256')
    new_user = User(
        username=data['username'],
        email=data['email'],
        password=hashed_password
    )
    db.session.add(new_user)
    
    # Manejo de reintentos para evitar bloqueos de SQLite
    max_retries = 5
    for attempt in range(max_retries):
        try:
            db.session.commit()
            return jsonify({'message': 'Usuario registrado exitosamente'}), 201
        except Exception as e:
            db.session.rollback()
            if 'locked' in str(e).lower() and attempt < max_retries - 1:
                import time
                time.sleep(0.5)
                db.session.add(new_user) # Re-añadimos tras el rollback
            else:
                print(f"Error en registro: {traceback.format_exc()}")
                return jsonify({'error': 'La base de datos está ocupada. Asegúrate de cerrar DB Browser.'}), 500

@auth.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Faltan datos'}), 400

    user = User.query.filter_by(email=data['email']).first()
    if not user or not check_password_hash(user.password, data['password']):
        return jsonify({'error': 'Credenciales inválidas'}), 401

    access_token = create_access_token(identity=str(user.id), expires_delta=timedelta(hours=24))
    return jsonify({
        'access_token': access_token,
        'user': user.to_dict()
    }), 200

@auth.route('/google-login', methods=['POST'])
def google_login():
    data = request.get_json()
    if not data or 'id_token' not in data:
        return jsonify({'error': 'No se proporcionó el token de Google'}), 400

    token = data.get('id_token')

    client_id = get_google_client_id()
    if not client_id:
        print("CRÍTICO: GOOGLE_CLIENT_ID no está definido en las variables de entorno (.env)")
        return jsonify({'error': 'Configuración del servidor incompleta'}), 500

    try:
        # Verificar el token con Google
        # Agregamos clock_skew para tolerar desincronizacion de tiempo entre cliente/servidor
        # Nota: El parametro correcto es clock_skew, no clock_skew_in_seconds
        # Parametro clock_skew compatible con todas las versiones de google-auth
        try:
            # Version nueva
            idinfo = id_token.verify_oauth2_token(
                token, 
                google_requests.Request(), 
                client_id,
                clock_skew_in_seconds=30
            )
        except TypeError:
            # Version antigua
            idinfo = id_token.verify_oauth2_token(
                token, 
                google_requests.Request(), 
                client_id,
                clock_skew=30
            )

        # Obtener información del usuario desde Google
        email = idinfo['email']
        username = idinfo.get('name', email.split('@')[0])

        # Buscar si el usuario ya existe
        user = User.query.filter_by(email=email).first()

        if not user:
            # Asegurar que el username sea único y no exceda el límite de 80 caracteres
            # Metodo optimizado: busqueda en una sola consulta sin ciclo
            base_username = username[:70]
            existing_users = User.query.filter(User.username.like(f"{base_username}%")).all()
            existing_suffixes = []
            
            for u in existing_users:
                suffix = u.username.replace(base_username, "")
                if suffix.isdigit():
                    existing_suffixes.append(int(suffix))
            
            if not existing_suffixes:
                final_username = base_username
            else:
                final_username = f"{base_username}{max(existing_suffixes) + 1}"

            # Si no existe, lo registramos
            user = User(
                username=final_username,
                email=email,
                password=generate_password_hash(os.urandom(24).hex(), method='pbkdf2:sha256')
            )
            db.session.add(user)
            # Reintentos automaticos para evitar database is locked en SQLite
            max_retries = 5
            for attempt in range(max_retries):
                try:
                    db.session.commit()
                    break
                except Exception as e:
                    db.session.rollback()
                    if 'locked' in str(e).lower() and attempt < max_retries -1:
                        import time
                        time.sleep(0.5)
                        db.session.add(user) # Re-añadir el objeto tras rollback
                    else:
                        raise

        # Generar token JWT (convertimos ID a string para asegurar compatibilidad de serialización)
        access_token = create_access_token(identity=str(user.id), expires_delta=timedelta(hours=24))
        
        return jsonify({
            'access_token': access_token,
            'user': user.to_dict(),
            'message': 'Inicio de sesión con Google exitoso'
        }), 200

    except ValueError as e:
        # Token inválido o problema de configuración
        print(f"Error de validación de Google: {str(e)}")
        return jsonify({'error': f'Token de Google inválido: {str(e)}'}), 400
    except Exception as e:
        db.session.rollback()
        print(f"--- ERROR EN GOOGLE LOGIN ---\n{traceback.format_exc()}")
        return jsonify({'error': 'Error interno al procesar el acceso con Google'}), 500

# Blueprint de promociones
promotions = Blueprint('promotions', __name__)

@promotions.route('/', methods=['GET'])
def get_promotions():
    # Obtenemos la fecha actual para mostrar solo promos vigentes
    now = datetime.now()
    active_promos = Promotion.query.filter(Promotion.expiration_date >= now).all()
    return jsonify([p.to_dict() for p in active_promos]), 200

# Blueprint de productos
products = Blueprint('products', __name__)

@products.route('/', methods=['GET'])
def get_products():
    categories = Category.query.all()
    return jsonify([cat.to_dict() for cat in categories]), 200

@products.route('/<int:product_id>', methods=['GET'])
def get_product(product_id):
    product = Product.query.get_or_404(product_id)
    return jsonify(product.to_dict()), 200

# Blueprint de pagos
payments = Blueprint('payments', __name__)

@payments.route('/process', methods=['POST'])
@jwt_required()
def process_payment():
    data = request.get_json(silent=True)

    if not data:
        return jsonify({"error": "No se recibió información de pago"}), 422

    current_user = int(get_jwt_identity())
    # Verificar si el usuario existe para evitar el error 500
    user = User.query.get(current_user)
    if not user:
        return jsonify({'error': f'El usuario de prueba con ID {current_user} no existe en la DB. Ejecuta seed_db.py'}), 404

    if not stripe.api_key:
        return jsonify({'error': 'La clave API de Stripe no está configurada en el servidor.'}), 500

    if not data or not data.get('items') or not data.get('payment_method'):
        return jsonify({'error': 'Faltan datos obligatorios'}), 422

    total = 0
    items_to_process = []
    
    # Validar productos y promociones
    for item in data['items']:
        if item.get('promo_id'):
            # Es una promoción
            promo = Promotion.query.get(item['promo_id'])
            if not promo:
                return jsonify({'error': 'Promoción no encontrada'}), 404
            
            total += promo.promo_price * item['quantity']
            # Validar stock de cada item dentro de la promo
            for pi in promo.items:
                if pi.product.stock < (pi.quantity * item['quantity']):
                    return jsonify({'error': f'Stock insuficiente para {pi.product.name} en la promoción'}), 400
                items_to_process.append({
                    'product': pi.product,
                    'quantity': pi.quantity * item['quantity'],
                    'price_at_moment': promo.promo_price / len(promo.items) # Precio prorrateado
                })
        else:
            # Es un producto individual
            product = Product.query.get(item['product_id'])
            if not product or product.stock < item['quantity']:
                print(f"Error de stock: Producto {product.name if product else item['product_id']} - Solicitado: {item['quantity']}, Disponible: {product.stock if product else 'N/A'}")
                return jsonify({'error': f'Stock insuficiente para {product.name if product else "producto desconocido"}'}), 400
            
            total += product.price * item['quantity']
            items_to_process.append({'product': product, 'quantity': item['quantity'], 'price_at_moment': product.price})

    order = Order(
        user_id=current_user,
        total=total,
        status='Pendiente de envío',
        phone=data.get('phone'),
        address=data.get('address'),
        delivery_date=data.get('delivery_date'),
        delivery_time=data.get('delivery_time')
    )
    db.session.add(order)
    db.session.flush()

    for entry in items_to_process:
        item = OrderItem(
            order_id=order.id,
            product_id=entry['product'].id,
            quantity=entry['quantity'],
            price=entry['price_at_moment']
        )
        db.session.add(item)
        entry['product'].stock -= entry['quantity']

    # Procesar pago con Stripe
    try:
        payment_intent = stripe.PaymentIntent.create(
            amount=int(total * 100),  # Convertir a centavos
            currency='mxn',
            payment_method=data['payment_method'],
            confirm=True,
            automatic_payment_methods={"enabled": True, "allow_redirects": "never"},
            # return_url no es necesario si allow_redirects es "never"
        )

        # Crear registro de pago
        payment = Payment(
            order_id=order.id,
            amount=total,
            method='stripe',
            status=payment_intent.status,
            transaction_id=payment_intent.id
        )
        db.session.add(payment)
        db.session.flush()

        db.session.commit()

        return jsonify({
            'message': 'Pago procesado exitosamente',
            'order': order.to_dict(),
            'payment': payment.to_dict(),
            'payment_intent': payment_intent.to_dict()
        }), 201

    except stripe.error.StripeError as e:
        print(f"Error de Stripe: {str(e)}")
        db.session.rollback()
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        db.session.rollback()
        print(f"--- ERROR INTERNO ---\n{traceback.format_exc()}") 
        return jsonify({'error': 'Error interno del servidor al procesar el pedido'}), 500

# Blueprint de órdenes
orders = Blueprint('orders', __name__)

@orders.route('/', methods=['GET'])
@jwt_required()
def get_orders():
    current_user = int(get_jwt_identity())
    orders = Order.query.filter_by(user_id=current_user).all()
    return jsonify([order.to_dict() for order in orders]), 200

@orders.route('/<int:order_id>', methods=['GET'])
@jwt_required()
def get_order(order_id):
    current_user = int(get_jwt_identity())
    order = Order.query.filter_by(id=order_id, user_id=current_user).first_or_404()
    return jsonify(order.to_dict()), 200

# Ruta para servir la página principal
main = Blueprint('main', __name__)

@main.route('/')
def index():
    import os
    return send_from_directory(os.getcwd(), 'principal.html')

@main.route('/<path:filename>')
def serve_static(filename):
    import os
    return send_from_directory(os.getcwd(), filename)