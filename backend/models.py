from backend import db
from datetime import datetime

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    email = db.Column(db.String(120), unique=True, nullable=False)
    password = db.Column(db.String(255), nullable=False)

    def to_dict(self):
        return {"id": self.id, "username": self.username, "email": self.email}

    def __repr__(self):
        return f'<User {self.username} ({self.email})>'

class Category(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), unique=True, nullable=False)
    description = db.Column(db.String(255))
    image_url = db.Column(db.String(255))
    products = db.relationship('Product', backref='category', lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "image_url": self.image_url,
            "products": [p.to_dict() for p in self.products]
        }

class Product(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    description = db.Column(db.String(255))
    price = db.Column(db.Float, nullable=False)
    stock = db.Column(db.Integer, default=0)
    image_url = db.Column(db.String(255))
    ideal_for = db.Column(db.String(255))
    category_id = db.Column(db.Integer, db.ForeignKey('category.id'), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "price": self.price,
            "stock": self.stock,
            "image_url": self.image_url,
            "ideal_for": self.ideal_for
        }

    def __repr__(self):
        return f'<Product {self.name} - ${self.price}>'

class Order(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    total = db.Column(db.Float, nullable=False)
    status = db.Column(db.String(50), default='Pendiente de envío')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Campos de entrega adicionales
    phone = db.Column(db.String(20))
    address = db.Column(db.Text)
    delivery_date = db.Column(db.String(20))
    delivery_time = db.Column(db.String(20))

    items = db.relationship('OrderItem', backref='order', lazy=True)

    def to_dict(self):
        return {
            "id": self.id,
            "user_id": self.user_id,
            "status": self.status,
            "phone": self.phone,
            "address": self.address,
            "delivery_date": self.delivery_date,
            "delivery_time": self.delivery_time,
            "created_at": self.created_at.isoformat(),
            "items": [item.to_dict() for item in self.items],
            "total": self.total, # Mover total al final para consistencia
        }

class OrderItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('order.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('product.id'), nullable=False)
    quantity = db.Column(db.Integer, nullable=False)
    price = db.Column(db.Float, nullable=False)
    product = db.relationship('Product')

    def to_dict(self):
        return {
            "product_name": self.product.name,
            "quantity": self.quantity,
            "price": self.price
        }

class Payment(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    order_id = db.Column(db.Integer, db.ForeignKey('order.id'), nullable=False)
    amount = db.Column(db.Float, nullable=False)
    method = db.Column(db.String(50))
    status = db.Column(db.String(50))
    transaction_id = db.Column(db.String(255))

    def to_dict(self):
        return {
            "id": self.id,
            "order_id": self.order_id,
            "amount": self.amount,
            "status": self.status,
            "transaction_id": self.transaction_id
        }

class Promotion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    header_title = db.Column(db.String(100), nullable=False)    # ej: 🎉 TEMPORADA DE FIESTAS
    header_subtitle = db.Column(db.String(100))                 # ej: ¡Hasta 30% de descuento!
    promo_name = db.Column(db.String(100), nullable=False)      # ej: Paquete Fiesta Perfecta
    description = db.Column(db.Text)                            # ej: Ideal para cumpleaños...
    original_price = db.Column(db.Float, nullable=False)        # ej: 150
    promo_price = db.Column(db.Float, nullable=False)           # ej: 105
    expiration_date = db.Column(db.DateTime, nullable=False)    # ej: 2026-05-15
    color_scheme = db.Column(db.String(20), default='warning')  # 'warning', 'success', 'info'

    # Relación con los items que componen la promo
    items = db.relationship('PromotionItem', backref='promotion', lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {
            'id': self.id,
            'header_title': self.header_title,
            'header_subtitle': self.header_subtitle,
            'promo_name': self.promo_name,
            'description': self.description,
            'original_price': self.original_price,
            'promo_price': self.promo_price,
            'expiration_date': self.expiration_date.isoformat(),
            'color_scheme': self.color_scheme,
            'items': [item.to_dict() for item in self.items]
        }

class PromotionItem(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    promotion_id = db.Column(db.Integer, db.ForeignKey('promotion.id'), nullable=False)
    product_id = db.Column(db.Integer, db.ForeignKey('product.id'), nullable=False)
    quantity = db.Column(db.Integer, default=1)
    
    # Relación para obtener detalles del producto fácilmente
    product = db.relationship('Product')

    def to_dict(self):
        return {
            'product_id': self.product_id,
            'product_name': self.product.name if self.product else "Producto desconocido",
            'quantity': self.quantity
        }
    