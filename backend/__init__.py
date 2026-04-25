from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from flask_jwt_extended import JWTManager
from flask_cors import CORS
from flask_migrate import Migrate
import os
from dotenv import load_dotenv
from sqlalchemy import event
import stripe
from sqlalchemy.engine import Engine

load_dotenv()

db = SQLAlchemy()
jwt = JWTManager()

def create_app():
    app = Flask(__name__)
    
    # Definimos la ruta absoluta para la base de datos
    basedir = os.path.abspath(os.path.dirname(__file__))
    db_path = os.path.join(basedir, '..', 'instance', 'hielito.db')
    
    # Asegurar que la carpeta 'instance' existe para evitar errores 500
    os.makedirs(os.path.dirname(db_path), exist_ok=True)

    # Configurar Stripe API Key
    stripe.api_key = os.getenv('STRIPE_API_KEY')

    app.config['SQLALCHEMY_DATABASE_URI'] = os.getenv('DATABASE_URL', f'sqlite:///{db_path}')
    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'super-secret-key')
    
    # Configuracion para evitar database is locked en SQLite
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = {
        'connect_args': {
            'timeout': 30,
            'check_same_thread': False
        },
        'pool_pre_ping': True
    }
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    db.init_app(app)

    # Configuración de PRAGMAs para SQLite mediante eventos de SQLAlchemy
    @event.listens_for(Engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        # Establecemos el timeout primero para que la conexión espere si el archivo está ocupado
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.execute("PRAGMA foreign_keys=ON")
        
        # El modo WAL es persistente. Intentamos activarlo, pero si la DB está ocupada,
        # no dejamos que la aplicación truene, ya que probablemente ya esté activo.
        try:
            cursor.execute("PRAGMA journal_mode=WAL")
        except Exception:
            pass
            
        cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.execute("PRAGMA cache_size=-20000")
        cursor.close()

    jwt.init_app(app)
    CORS(app, supports_credentials=True, origins=["http://127.0.0.1:5000", "http://localhost:5000", "*"])
    Migrate(app, db)

    # Cabeceras para solucionar error Cross-Origin-Resource-Policy Google Sign-In
    @app.after_request
    def add_cors_headers(response):
        response.headers['Cross-Origin-Embedder-Policy'] = 'unsafe-none'
        response.headers['Cross-Origin-Resource-Policy'] = 'cross-origin'
        response.headers['Cross-Origin-Opener-Policy'] = 'same-origin-allow-popups'
        response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
        return response

    from backend.routes import auth, products, payments, orders, main
    app.register_blueprint(auth, url_prefix='/api/auth')
    app.register_blueprint(products, url_prefix='/api/products')
    app.register_blueprint(payments, url_prefix='/api/payments')
    app.register_blueprint(orders, url_prefix='/api/orders')
    app.register_blueprint(main, url_prefix='/')

    return app