from flask import Blueprint, request, jsonify, send_from_directory
from backend import db, jwt
from backend.models import User, Product, Order, Payment
from werkzeug.security import generate_password_hash, check_password_hash
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity
from datetime import datetime, timedelta
import stripe
import traceback
import os

# Configurar Stripe
stripe.api_key = os.getenv('STRIPE_API_KEY')

# Blueprint de autenticación
auth = Blueprint('auth', __name__)

@auth.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not data.get('username') or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Faltan datos'}), 400

    if User.query.filter_by(email=data['email']).first():
        return jsonify({'error': 'Email ya registrado'}), 400

    hashed_password = generate_password_hash(data['password'])
    new_user = User(
        username=data['username'],
        email=data['email'],
        password=hashed_password
    )
    db.session.add(new_user)
    db.session.commit()

    return jsonify({'message': 'Usuario registrado exitosamente'}), 201

@auth.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return jsonify({'error': 'Faltan datos'}), 400

    user = User.query.filter_by(email=data['email']).first()
    if not user or not check_password_hash(user.password, data['password']):
        return jsonify({'error': 'Credenciales inválidas'}), 401

    access_token = create_access_token(identity=user.id, expires_delta=timedelta(hours=24))
    return jsonify({
        'access_token': access_token,
        'user': user.to_dict()
    }), 200

# Blueprint de productos
products = Blueprint('products', __name__)

@products.route('/', methods=['GET'])
def get_products():
    products = Product.query.all()
    return jsonify([product.to_dict() for product in products]), 200

@products.route('/<int:product_id>', methods=['GET'])
def get_product(product_id):
    product = Product.query.get_or_404(product_id)
    return jsonify(product.to_dict()), 200

# Blueprint de pagos
payments = Blueprint('payments', __name__)

@payments.route('/process', methods=['POST'])
# @jwt_required()  # Comentado para que puedas probar sin haber iniciado sesión
def process_payment():
    data = request.get_json()
    current_user = 1 # Usamos el ID del usuario de prueba que creamos con seed_db.py

    # Verificar si el usuario existe para evitar el error 500
    user = User.query.get(current_user)
    if not user:
        return jsonify({'error': f'El usuario de prueba con ID {current_user} no existe en la DB. Ejecuta seed_db.py'}), 404

    if not data or not data.get('product_id') or not data.get('quantity') or not data.get('payment_method'):
        return jsonify({'error': 'Faltan datos'}), 400

    product = Product.query.get(data['product_id'])
    if not product:
        return jsonify({'error': 'Producto no encontrado'}), 404

    if product.stock < data['quantity']:
        return jsonify({'error': 'Stock insuficiente'}), 400

    total = product.price * data['quantity']

    # Crear orden
    order = Order(
        user_id=current_user,
        product_id=product.id,
        quantity=data['quantity'],
        total=total
    )
    db.session.add(order)
    db.session.flush()

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

        # Actualizar stock
        product.stock -= data['quantity']
        db.session.commit()

        return jsonify({
            'message': 'Pago procesado exitosamente',
            'order': order.to_dict(),
            'payment': payment.to_dict(),
            'payment_intent': payment_intent.to_dict()
        }), 201

    except stripe.error.StripeError as e:
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
    current_user = get_jwt_identity()
    orders = Order.query.filter_by(user_id=current_user).all()
    return jsonify([order.to_dict() for order in orders]), 200

@orders.route('/<int:order_id>', methods=['GET'])
@jwt_required()
def get_order(order_id):
    current_user = get_jwt_identity()
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