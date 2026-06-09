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

    # Forzamos el uso de la ruta absoluta para SQLite para evitar errores de "unable to open database file"
    env_db_url = os.getenv('DATABASE_URL')
    is_sqlite = True

    if env_db_url:
        # Corrección para compatibilidad con SQLAlchemy 1.4+ en plataformas como Render
        if env_db_url.startswith("postgres://"):
            env_db_url = env_db_url.replace("postgres://", "postgresql://", 1)
        app.config['SQLALCHEMY_DATABASE_URI'] = env_db_url
        if not env_db_url.startswith('sqlite'):
            is_sqlite = False
    else:
        # Para desarrollo local con SQLite, usamos siempre la ruta absoluta calculada
        app.config['SQLALCHEMY_DATABASE_URI'] = f'sqlite:///{db_path}'

    app.config['JWT_SECRET_KEY'] = os.getenv('JWT_SECRET_KEY', 'super-secret-key')
    
    # Configuración de motor dinámica
    engine_options = {'pool_pre_ping': True}
    
    if is_sqlite:
        engine_options['connect_args'] = {
            'timeout': 30,
            'check_same_thread': False
        }
    
    app.config['SQLALCHEMY_ENGINE_OPTIONS'] = engine_options
    app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
    
    db.init_app(app)

    # Configuración de PRAGMAs SOLO para SQLite
    @event.listens_for(Engine, "connect")
    def set_sqlite_pragma(dbapi_connection, connection_record):
        # Verificar si la conexión es realmente SQLite antes de ejecutar PRAGMAs
        if not app.config['SQLALCHEMY_DATABASE_URI'].startswith('sqlite'):
            return
            
        cursor = dbapi_connection.cursor()
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

    from backend.routes import auth, products, payments, orders, main, promotions
    app.register_blueprint(auth, url_prefix='/api/auth')
    app.register_blueprint(products, url_prefix='/api/products')
    app.register_blueprint(promotions, url_prefix='/api/promotions')
    app.register_blueprint(payments, url_prefix='/api/payments')
    app.register_blueprint(orders, url_prefix='/api/orders')
    app.register_blueprint(main, url_prefix='/')

    return app