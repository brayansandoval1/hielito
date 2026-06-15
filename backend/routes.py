from flask import Blueprint, request, jsonify, send_from_directory
from backend import db, jwt
from backend.models import User, Product, Order, Payment, Category, OrderItem, Promotion, PromotionItem, StoreConfig
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import stripe
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from werkzeug.utils import secure_filename
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
        print("⚠️ Notificación de Telegram omitida: Faltan las variables TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID.")
        return

    mensaje = f"❄️ <b>¡NUEVO PEDIDO #{order.id}!</b>\n\n"
    mensaje += f"👤 <b>Cliente:</b> {order.user.username}\n"
    mensaje += f"💰 <b>Total:</b> ${order.total:.2f} MXN\n"
    mensaje += f"📍 <b>Dirección:</b> {order.address}\n"
    mensaje += f"📞 <b>Tel:</b> {order.phone}\n\n"
    mensaje += "📦 <b>Productos:</b>\n"
    if order.has_loyalty_prize:
        mensaje += "🎁 <b>¡ATENCIÓN: INCLUIR REGALO DE LEALTAD!</b> 🎁\n"
        
    for item in order.items:
        # Obtenemos el nombre real del producto desde la relación
        p_name = item.product.name if item.product else "Producto desconocido"
        mensaje += f"  • <b>{item.quantity}x</b> {p_name.upper()}\n"
        
    mensaje += "\n📱 Revisa el Panel Admin para programar la entrega."

    try:
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        response = requests.post(url, json={'chat_id': chat_id, 'text': mensaje, 'parse_mode': 'HTML'}, timeout=5)
        if response.status_code != 200:
            print(f"❌ Error de Telegram API (Status {response.status_code}): {response.text}")
        else:
            print(f"✅ Notificación del pedido #{order.id} enviada con éxito.")
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

@auth.route('/admin/users/<int:user_id>/toggle-loyalty', methods=['PUT'])
@jwt_required()
def toggle_user_loyalty(user_id):
    # Nota: Aquí deberías verificar si el usuario actual es admin
    user = User.query.get_or_404(user_id)
    data = request.get_json()
    if 'is_loyalty_active' in data:
        user.is_loyalty_active = data['is_loyalty_active']
        db.session.commit()
        return jsonify({'message': f'Lealtad para {user.username} actualizada'}), 200
    return jsonify({'error': 'Faltan datos'}), 400

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

@promotions.route('/<int:promo_id>', methods=['PUT'])
@jwt_required()
def update_promotion(promo_id):
    promo = Promotion.query.get_or_404(promo_id)
    data = request.get_json()
    try:
        promo.header_title = data['header_title']
        promo.header_subtitle = data.get('header_subtitle')
        promo.promo_name = data['promo_name']
        promo.description = data.get('description')
        promo.original_price = float(data['original_price'])
        promo.promo_price = float(data['promo_price'])
        promo.expiration_date = datetime.fromisoformat(data['expiration_date'].replace('Z', ''))
        promo.color_scheme = data.get('color_scheme', 'warning')

        # Eliminar items existentes y añadir los nuevos
        PromotionItem.query.filter_by(promotion_id=promo.id).delete()
        for item in data.get('items', []):
            pi = PromotionItem(promotion_id=promo.id, product_id=item['product_id'], quantity=item['quantity'])
            db.session.add(pi)
            
        db.session.commit()
        return jsonify(promo.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@promotions.route('/', methods=['POST'])
@jwt_required()
def create_promotion():
    data = request.get_json()
    try:
        new_promo = Promotion(
            header_title=data['header_title'],
            header_subtitle=data.get('header_subtitle'),
            promo_name=data['promo_name'],
            description=data.get('description'),
            original_price=float(data['original_price']),
            promo_price=float(data['promo_price']),
            expiration_date=datetime.fromisoformat(data['expiration_date'].replace('Z', '')),
            color_scheme=data.get('color_scheme', 'warning')
        )
        db.session.add(new_promo)
        db.session.flush()
        
        for item in data.get('items', []):
            pi = PromotionItem(promotion_id=new_promo.id, product_id=item['product_id'], quantity=item['quantity'])
            db.session.add(pi)
            
        db.session.commit()
        return jsonify(new_promo.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@promotions.route('/<int:promo_id>', methods=['DELETE'])
@jwt_required()
def delete_promotion(promo_id):
    promo = Promotion.query.get_or_404(promo_id)
    try:
        db.session.delete(promo)
        db.session.commit()
        return jsonify({'message': 'Promoción eliminada'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

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

@products.route('/upload', methods=['POST'])
@jwt_required()
def upload_image():
    """Ruta genérica para subir imágenes al servidor"""
    if 'file' not in request.files:
        return jsonify({'error': 'No se encontró el archivo'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Nombre de archivo vacío'}), 400

    if file:
        # Crear carpeta si no existe
        upload_dir = os.path.join(os.getcwd(), 'img')
        os.makedirs(upload_dir, exist_ok=True)
        
        filename = secure_filename(f"{int(time.time())}_{file.filename}")
        file_path = os.path.join(upload_dir, filename)
        file.save(file_path)
        
        # Retornamos la URL relativa para guardar en DB
        return jsonify({'url': f'img/{filename}'}), 200

@products.route('/', methods=['POST'])
@jwt_required()
def create_product():
    data = request.get_json()
    try:
        new_p = Product(
            name=data['name'],
            description=data.get('description'),
            weight=float(data.get('weight', 0)),
            price=float(data['price']),
            stock=int(data.get('stock', 0)),
            image_url=data.get('image_url'),
            ideal_for=data.get('ideal_for'),
            category_id=data['category_id'],
            is_active=data.get('is_active', True)
        )
        db.session.add(new_p)
        db.session.commit()
        return jsonify(new_p.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@products.route('/<int:product_id>', methods=['PUT'])
@jwt_required()
def update_product(product_id):
    p = Product.query.get_or_404(product_id)
    data = request.get_json()
    try:
        p.name = data['name']
        p.description = data.get('description')
        p.price = float(data['price'])
        p.stock = int(data.get('stock', 0))
        p.image_url = data.get('image_url')
        p.category_id = data['category_id']
        p.is_active = data.get('is_active', True)
        db.session.commit()
        return jsonify(p.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@products.route('/<int:product_id>', methods=['DELETE'])
@jwt_required()
def delete_product(product_id):
    p = Product.query.get_or_404(product_id)
    try:
        db.session.delete(p)
        db.session.commit()
        return jsonify({'message': 'Producto eliminado'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@products.route('/categories/<int:cat_id>', methods=['PUT'])
@jwt_required()
def update_category(cat_id):
    c = Category.query.get_or_404(cat_id)
    data = request.get_json()
    try:
        c.name = data['name']
        c.description = data.get('description')
        c.image_url = data.get('image_url')
        c.is_active = data.get('is_active', True)
        db.session.commit()
        return jsonify(c.to_dict()), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@products.route('/categories', methods=['POST'])
@jwt_required()
def create_category():
    data = request.get_json()
    try:
        new_c = Category(
            name=data['name'], 
            description=data.get('description'), 
            image_url=data.get('image_url'),
            is_active=data.get('is_active', True)
        )
        db.session.add(new_c)
        db.session.commit()
        return jsonify(new_c.to_dict()), 201
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@products.route('/categories/<int:cat_id>', methods=['DELETE'])
@jwt_required()
def delete_category(cat_id):
    c = Category.query.get_or_404(cat_id)
    try:
        db.session.delete(c)
        db.session.commit()
        return jsonify({'message': 'Categoría eliminada'}), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@products.route('/<int:product_id>', methods=['GET'])
def get_product(product_id):
    product = Product.query.get_or_404(product_id)
    return jsonify(product.to_dict()), 200

@products.route('/config', methods=['GET'])
def get_config():
    try:
        config_ice = StoreConfig.query.filter_by(key='is_ice_available').first()
        config_loyalty = StoreConfig.query.filter_by(key='loyalty_threshold_kg').first()
        config_loyalty_active = StoreConfig.query.filter_by(key='is_loyalty_active').first()
        config_whatsapp = StoreConfig.query.filter_by(key='whatsapp_phone').first()
        config_delivery = StoreConfig.query.filter_by(key='delivery_threshold_kg').first()
        
        return jsonify({
            'is_ice_available': config_ice.value == 'true' if config_ice else True,
            'loyalty_threshold_kg': int(config_loyalty.value) if config_loyalty else 50,
            'is_loyalty_active': config_loyalty_active.value == 'true' if config_loyalty_active else True,
            'whatsapp_phone': config_whatsapp.value if config_whatsapp else "527352282129",
            'delivery_threshold_kg': int(config_delivery.value) if config_delivery else 20
        }), 200
    except Exception as e:
        print(f"Error en get_config: {e}")
        return jsonify({'is_ice_available': True}), 200

@products.route('/config', methods=['PUT'])
@jwt_required()
def update_config():
    data = request.get_json()
    
    if 'is_ice_available' in data:
        config = StoreConfig.query.filter_by(key='is_ice_available').first()
        if not config:
            config = StoreConfig(key='is_ice_available', value='true')
            db.session.add(config)
        config.value = 'true' if data.get('is_ice_available') else 'false'
        
    if 'loyalty_threshold_kg' in data:
        config = StoreConfig.query.filter_by(key='loyalty_threshold_kg').first()
        if not config:
            config = StoreConfig(key='loyalty_threshold_kg', value='50')
            db.session.add(config)
        config.value = str(data.get('loyalty_threshold_kg'))

    if 'delivery_threshold_kg' in data:
        config = StoreConfig.query.filter_by(key='delivery_threshold_kg').first()
        if not config:
            config = StoreConfig(key='delivery_threshold_kg', value='20')
            db.session.add(config)
        config.value = str(data.get('delivery_threshold_kg'))

    if 'is_loyalty_active' in data:
        config = StoreConfig.query.filter_by(key='is_loyalty_active').first()
        if not config:
            config = StoreConfig(key='is_loyalty_active', value='true')
            db.session.add(config)
        config.value = 'true' if data.get('is_loyalty_active') else 'false'

    if 'whatsapp_phone' in data:
        config = StoreConfig.query.filter_by(key='whatsapp_phone').first()
        if not config:
            config = StoreConfig(key='whatsapp_phone', value='527352282129')
            db.session.add(config)
        config.value = str(data.get('whatsapp_phone'))

    try:
        db.session.commit()
        return jsonify({'message': 'Configuración actualizada'}), 200
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

    # --- LÓGICA DE LEALTAD AUTOMÁTICA ---
    # Verificar si el cliente es elegible para premio en este pedido
    loyalty_active_cfg = StoreConfig.query.filter_by(key='is_loyalty_active').first()
    is_loyalty_active_global = loyalty_active_cfg.value == 'true' if loyalty_active_cfg else True

    should_include_prize = False
    if is_loyalty_active_global and user.is_loyalty_active:
        user_orders = Order.query.filter_by(user_id=current_user, status='Entregado').all()
        hist_w = 0
        for o in user_orders:
            for i in o.items:
                hist_w += (i.product.weight if i.product else 0) * i.quantity
        
        available_w = hist_w - (user.loyalty_redeemed_kg or 0)
        threshold_cfg = StoreConfig.query.filter_by(key='loyalty_threshold_kg').first()
        threshold = float(threshold_cfg.value) if threshold_cfg else 50.0
        should_include_prize = available_w >= threshold
    # ------------------------------------

    order = Order(
        user_id=current_user,
        total=total,
        status='Pendiente de envío',
        phone=data.get('phone'),
        address=data.get('address'),
        cp=data.get('cp'),
        delivery_date=data.get('delivery_date'),
        delivery_time=data.get('delivery_time'),
        has_loyalty_prize=should_include_prize
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

    # --- OPCIÓN: PEDIDO POR WHATSAPP ---
    if data['payment_method'] == 'whatsapp':
        try:
            # Creamos el registro de pago como "pendiente"
            payment = Payment(
                order_id=order.id,
                amount=total,
                method='whatsapp',
                status='pendiente_whatsapp',
                transaction_id=f"WA-{order.id}-{int(time.time())}"
            )
            db.session.add(payment)
            db.session.commit()
            
            send_admin_notification(order)
            return jsonify({
                'message': 'Pedido por WhatsApp registrado exitosamente',
                'order': order.to_dict()
            }), 201
        except Exception as e:
            db.session.rollback()
            return jsonify({'error': 'Error al registrar pedido de WhatsApp'}), 500

    # Procesar pago con Stripe
    if not stripe.api_key or "aqui" in stripe.api_key:
        return jsonify({'error': 'La clave API de Stripe no está configurada en el servidor.'}), 500

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
    loyalty_active_cfg = StoreConfig.query.filter_by(key='is_loyalty_active').first()
    is_loyalty_active_global = loyalty_active_cfg.value == 'true' if loyalty_active_cfg else True

    user = User.query.get(current_user)
    user_orders = Order.query.filter_by(user_id=current_user).order_by(Order.created_at.desc()).all()
    
    # Calcular peso acumulado de pedidos entregados
    total_historical_weight = 0
    for order in user_orders:
        if order.status == 'Entregado':
            for item in order.items:
                total_historical_weight += (item.product.weight if item.product else 0) * item.quantity

    # El peso disponible es el total menos lo que ya canjeó
    available_weight = max(0, total_historical_weight - (user.loyalty_redeemed_kg if user.loyalty_redeemed_kg else 0))

    return jsonify({
        'orders': [order.to_dict() for order in user_orders],
        'accumulated_weight': round(available_weight, 2),
        'loyalty_active': is_loyalty_active_global and user.is_loyalty_active
    }), 200

@orders.route('/admin/all', methods=['GET'])
@jwt_required()
def get_all_orders_admin():
    # Nota: En un entorno real, aquí verificaríamos si el usuario es is_admin=True
    all_orders = Order.query.order_by(Order.created_at.desc()).all()
    
    # Enriquecemos la respuesta con el nombre de usuario para el panel admin
    orders_data = []
    for order in all_orders:
        # Calcular peso acumulado total histórico del usuario de este pedido
        user_hist_w = 0
        delivered_orders = Order.query.filter_by(user_id=order.user_id, status='Entregado').all()
        for d_order in delivered_orders:
            for item in d_order.items:
                user_hist_w += (item.product.weight if item.product else 0) * item.quantity

        available_w = max(0, user_hist_w - (order.user.loyalty_redeemed_kg if order.user.loyalty_redeemed_kg else 0))

        d = order.to_dict()
        d['username'] = order.user.username if order.user else 'Cliente'
        d['user_is_loyalty_active'] = order.user.is_loyalty_active if order.user else True
        d['user_accumulated_weight'] = round(available_w, 2)
        orders_data.append(d)
        
    return jsonify(orders_data), 200

@orders.route('/admin/redeem-loyalty/<int:user_id>', methods=['POST'])
@jwt_required()
def redeem_loyalty(user_id):
    # Aquí se registra que el admin entregó el premio y se "restan" los kilos de la meta
    user = User.query.get_or_404(user_id)
    config_loyalty = StoreConfig.query.filter_by(key='loyalty_threshold_kg').first()
    threshold = float(config_loyalty.value) if config_loyalty else 50.0

    # Aumentamos el contador de kilos canjeados
    user.loyalty_redeemed_kg = (user.loyalty_redeemed_kg or 0.0) + threshold
    
    try:
        db.session.commit()
        return jsonify({
            'message': f'Premio canjeado para {user.username}. Se han descontado {threshold}kg de su balance actual.',
            'new_redeemed_total': user.loyalty_redeemed_kg
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500

@orders.route('/<int:order_id>/update', methods=['PUT'])
@jwt_required()
def update_order_status(order_id):
    data = request.get_json()
    order = Order.query.get_or_404(order_id)
    
    # Validación: Si el estatus es 'Enviado', se requiere fecha y hora de entrega
    if data.get('status') == 'Enviado':
        if not data.get('delivery_date') or not data.get('delivery_time'):
            return jsonify({'error': 'La fecha y hora de entrega son obligatorias para pedidos enviados.'}), 400

    if 'status' in data:
        new_status = data['status']
        old_status = order.status

        # Manejo de stock si se cancela o des-cancela desde el admin
        if new_status == 'Cancelado' and old_status != 'Cancelado':
            for item in order.items:
                if item.product:
                    item.product.stock += item.quantity
        elif old_status == 'Cancelado' and new_status != 'Cancelado':
            for item in order.items:
                if item.product:
                    item.product.stock -= item.quantity

        # Verificar si la lealtad está activa para procesar el canje
        loyalty_active_cfg = StoreConfig.query.filter_by(key='is_loyalty_active').first()
        is_loyalty_active_global = loyalty_active_cfg.value == 'true' if loyalty_active_cfg else True

        # LÓGICA DE LEALTAD: Si el pedido pasa a 'Entregado' y tenía premio, se procesa el canje
        if new_status == 'Entregado' and old_status != 'Entregado' and order.has_loyalty_prize and is_loyalty_active_global and order.user.is_loyalty_active:
            config_loyalty = StoreConfig.query.filter_by(key='loyalty_threshold_kg').first()
            threshold = float(config_loyalty.value) if config_loyalty else 50.0
            # Sumamos la meta a lo canjeado para "reiniciar" el contador manteniendo el excedente
            order.user.loyalty_redeemed_kg = (order.user.loyalty_redeemed_kg or 0.0) + threshold

        order.status = new_status
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

@orders.route('/<int:order_id>/cancel', methods=['POST'])
@jwt_required()
def cancel_order(order_id):
    """Permite al cliente cancelar un pedido si aún no ha sido enviado"""
    current_user = int(get_jwt_identity())
    order = Order.query.filter_by(id=order_id, user_id=current_user).first_or_404()

    # Solo permitir cancelación si el estatus es el inicial
    if order.status != 'Pendiente de envío':
        return jsonify({'error': 'Solo se pueden cancelar pedidos que estén pendientes de envío.'}), 400

    try:
        # Devolver el stock de los productos al inventario
        for item in order.items:
            if item.product:
                item.product.stock += item.quantity

        order.status = 'Cancelado'
        db.session.commit()
        return jsonify({'message': 'Pedido cancelado exitosamente y stock devuelto.'}), 200
    except Exception as e:
        db.session.rollback()
        print(f"Error al cancelar pedido: {e}")
        return jsonify({'error': 'No se pudo cancelar el pedido en este momento.'}), 500

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