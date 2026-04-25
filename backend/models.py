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