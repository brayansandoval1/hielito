from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_migrate import Migrate
import os
from dotenv import load_dotenv

load_dotenv()

db = SQLAlchemy()
jwt = JWTManager()

def create_app():
    app = Flask(__name__)
    
    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', 'sqlite:///hielito.db')
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'super-secret-key')
    
    db.init_app(app)
    jwt.init_app(app)
    CORS(app)
    Migrate(app, db)

    from backend.routes import auth, products, payments, orders, main
    app.register_blueprint(auth, url_prefix='/api/auth')
    app.register_blueprint(products, url_prefix='/api/products')
    app.register_blueprint(payments, url_prefix='/api/payments')
    app.register_blueprint(orders, url_prefix='/api/orders')
    app.register_blueprint(main, url_prefix='/')

    return app