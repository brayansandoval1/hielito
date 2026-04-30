from flask import Blueprint, request, jsonify, send_from_directory
from backend import db, jwt
from backend.models import User, Product, Order, Payment, Category, OrderItem, Promotion, PromotionItem, StoreConfig
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import stripe
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
import traceback
import os
import requests
import time

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

def send_admin_notification(order):
    """Envía una notificación al administrador vía Telegram"""
    token = os.getenv('TELEGRAM_BOT_TOKEN') # Debes crear un bot en BotFather
    chat_id = os.getenv('TELEGRAM_CHAT_ID') # Tu ID de chat de Telegram
    if not token or not chat_id:
        return

    mensaje = f"❄️ <b>¡NUEVO PEDIDO #{order.id}!</b>\n\n"
    mensaje += f"👤 <b>Cliente:</b> {order.user.username}\n"
    mensaje += f"💰 <b>Total:</b> ${order.total:.2f} MXN\n"
    mensaje += f"📍 <b>Dirección:</b> {order.address}\n"
    mensaje += f"📞 <b>Tel:</b> {order.phone}\n\n"
    mensaje += "📦 <b>Productos:</b>\n"
    for item in order.items:
        # Asegurarse de que product_name esté disponible, ya sea de un producto o una promoción
        product_name = item.product.name if item.product else "Producto desconocido"
        mensaje += f"  - {item.quantity}x {product_name} (${item.price:.2f} c/u)\n"
    mensaje += "� Revisa el Panel Admin para programar la entrega."

    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        requests.post(url, json={'chat_id': chat_id, 'text': mensaje, 'parse_mode': 'HTML'}, timeout=5)
    except Exception as e:
        print(f"Error enviando notificación: {e}")

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
            base_username = username[:70]
            existing_users = User.query.filter(User.username.like(f"{base_username}%")).all()
            existing_usernames = {u.username for u in existing_users}
            
            if base_username not in existing_usernames:
                final_username = base_username
            else:
                counter = 1
                while f"{base_username}{counter}" in existing_usernames:
                    counter += 1
                final_username = f"{base_username}{counter}"

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
                        time.sleep(0.5)
                        db.session.add(user) # Re-añadir el objeto tras rollback
                    else:
                        print(f"Error fatal registrando usuario Google: {traceback.format_exc()}")
                        return jsonify({'error': 'Error al registrar usuario'}), 500

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
    try:
        # Obtenemos la fecha actual para mostrar solo promos vigentes
        now = datetime.now()
        active_promos = Promotion.query.filter(Promotion.expiration_date >= now).all()
        return jsonify([p.to_dict() for p in active_promos]), 200
    except Exception as e:
        print(f"Error en get_promotions: {e}")
        return jsonify([]), 200 # Devolvemos lista vacía para no romper el front

# Blueprint de productos
products = Blueprint('products', __name__)

@products.route('/', methods=['GET'])
def get_products():
    try:
        categories = Category.query.all()
        return jsonify([cat.to_dict() for cat in categories]), 200
    except Exception as e:
        print(f"Error en get_products: {traceback.format_exc()}")
        return jsonify({'error': 'Error de base de datos'}), 500

@products.route('/<int:product_id>', methods=['GET'])
def get_product(product_id):
    product = Product.query.get_or_404(product_id)
    return jsonify(product.to_dict()), 200

@products.route('/config', methods=['GET'])
def get_config():
    try:
        config = StoreConfig.query.filter_by(key='is_ice_available').first()
        # Si no existe en la DB, asumimos disponible por defecto para no romper el front
        is_available = config.value == 'true' if config else True
        return jsonify({'is_ice_available': is_available}), 200
    except Exception as e:
        print(f"Error en get_config: {e}")
        return jsonify({'is_ice_available': True}), 200

@products.route('/config', methods=['PUT'])
@jwt_required()
def update_config():
    data = request.get_json()
    config = StoreConfig.query.filter_by(key='is_ice_available').first()
    if not config:
        config = StoreConfig(key='is_ice_available', value='true')
        db.session.add(config)
    
    config.value = 'true' if data.get('is_ice_available') else 'false'
    try:
        db.session.commit()
        return jsonify({'message': 'Disponibilidad actualizada'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

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

    # 1. Verificar disponibilidad global de hielo antes de procesar cualquier pago
    ice_config = StoreConfig.query.filter_by(key='is_ice_available').first()
    if ice_config and ice_config.value == 'false':
        return jsonify({'error': 'Lo sentimos, en este momento no tenemos hielo disponible. Por favor intenta más tarde o contáctanos por WhatsApp.'}), 403

    if not stripe.api_key or "aqui" in stripe.api_key:
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
        cp=data.get('cp'),
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

        # Enviar notificación al celular del dueño
        send_admin_notification(order)

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

@orders.route('/admin/all', methods=['GET'])
@jwt_required()
def get_all_orders_admin():
    # Nota: En un entorno real, aquí verificaríamos si el usuario es is_admin=True
    all_orders = Order.query.order_by(Order.created_at.desc()).all()
    
    # Enriquecemos la respuesta con el nombre de usuario para el panel admin
    orders_data = []
    for order in all_orders:
        d = order.to_dict()
        d['username'] = order.user.username if order.user else 'Cliente'
        orders_data.append(d)
        
    return jsonify(orders_data), 200

@orders.route('/<int:order_id>/update', methods=['PUT'])
@jwt_required()
def update_order_status(order_id):
    data = request.get_json()
    order = Order.query.get_or_404(order_id)
    
    if 'status' in data:
        order.status = data['status']
    if 'delivery_date' in data:
        order.delivery_date = data['delivery_date']
    if 'delivery_time' in data:
        order.delivery_time = data['delivery_time']
        
    try:
        db.session.commit()
        return jsonify({'message': 'Pedido actualizado', 'order': order.to_dict()}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

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