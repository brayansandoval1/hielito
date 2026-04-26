from app import app, db
from backend.models import Product, User, Category, Promotion, PromotionItem
from werkzeug.security import generate_password_hash
from datetime import datetime

def seed_products():
    with app.app_context():
        print("Reiniciando base de datos...")
        db.drop_all()
        db.create_all()

        # Crear usuario de prueba
        test_user = User(
            username="usuario_prueba",
            email="test@hielito.com",
            password=generate_password_hash("password123", method='pbkdf2:sha256')
        )
        db.session.add(test_user)

        # Definir Categorías y sus productos dinámicos
        data = [
            {
                "category": "HIELO EN BOLSA",
                "description": "Variedad de presentaciones para tu hogar o evento.",
                "image": "img/bolsa.jpeg",
                "items": [
                    {"name": "Bolsa 1/2 kg", "price": 25.0, "ideal": "Eventos pequeños"},
                    {"name": "Bolsa 1 kg", "price": 40.0, "ideal": "Eventos medianos"},
                    {"name": "Bolsa 2 kg", "price": 70.0, "ideal": "Eventos grandes"},
                    {"name": "Bolsa 3 kg", "price": 95.0, "ideal": "Eventos masivos"},
                    {"name": "Bolsa 5 kg", "price": 150.0, "ideal": "Eventos corporativos"}
                ]
            },
            {
                "category": "VASOS DE HIELO",
                "description": "Listos para servir en tus fiestas.",
                "image": "img/vaso.jpeg",
                "items": [
                    {"name": "10 vasos", "price": 80.0, "ideal": "Fiesta pequeña"},
                    {"name": "25 vasos", "price": 180.0, "ideal": "Fiesta mediana"},
                    {"name": "50 vasos", "price": 320.0, "ideal": "Fiesta grande"},
                    {"name": "100 vasos", "price": 550.0, "ideal": "Evento corporativo"}
                ]
            },
            {
                "category": "HIELO TRITURADO PARA RASPADO EN BOLSA",
                "description": "Textura perfecta para refrescar.",
                "image": "img/triturado.jpeg",
                "items": [
                    {"name": "1 kg", "price": 35.0, "ideal": "Raspados individuales"},
                    {"name": "5 kg", "price": 150.0, "ideal": "Puesto de raspados"},
                    {"name": "10 kg", "price": 280.0, "ideal": "Evento grande"},
                    {"name": "20 kg", "price": 500.0, "ideal": "Feria o festival"}
                ]
            },
            {
                "category": "HIELO POR CUBETA",
                "description": "Para bares y restaurantes.",
                "image": "img/cubeta.jpeg",
                "items": [
                    {"name": "1 cubeta", "price": 120.0, "ideal": "Bar pequeño"},
                    {"name": "3 cubetas", "price": 320.0, "ideal": "Restaurante"},
                    {"name": "5 cubetas", "price": 500.0, "ideal": "Bar grande"},
                    {"name": "10 cubetas", "price": 900.0, "ideal": "Hotel o evento"}
                ]
            }
        ]

        for cat_data in data:
            category = Category(
                name=cat_data["category"],
                description=cat_data["description"],
                image_url=cat_data["image"]
            )
            db.session.add(category)
            db.session.flush() # Para obtener el ID de la categoría y asignarlo a los productos

            for item in cat_data["items"]:
                product = Product(
                    name=item["name"],
                    price=item["price"],
                    ideal_for=item["ideal"],
                    category_id=category.id,
                    stock=100,
                    image_url=cat_data["image"]
                )
                db.session.add(product)
        
        db.session.flush()

        print("Cargando promociones...")
        
        # 1. Temporada de Fiestas
        promo1 = Promotion(
            header_title="🎉 TEMPORADA DE FIESTAS",
            header_subtitle="¡Hasta 30% de descuento!",
            promo_name="Paquete Fiesta Perfecta",
            description="Ideal para cumpleaños, bodas y eventos especiales.",
            original_price=150.0,
            promo_price=105.0,
            expiration_date=datetime(2026, 5, 15, 23, 59, 59),
            color_scheme="warning"
        )
        db.session.add(promo1)
        db.session.flush()

        # Buscamos los productos para vincularlos a la promo
        p_bolsa_2kg = Product.query.filter_by(name="Bolsa 2 kg").first()
        p_vasos_25 = Product.query.filter_by(name="25 vasos").first()
        if p_bolsa_2kg and p_vasos_25:
            db.session.add(PromotionItem(promotion_id=promo1.id, product_id=p_bolsa_2kg.id, quantity=1))
            db.session.add(PromotionItem(promotion_id=promo1.id, product_id=p_vasos_25.id, quantity=1))

        # 2. Mayoreo Especial
        promo2 = Promotion(
            header_title="🏪 MAYOREO ESPECIAL",
            header_subtitle="¡Descuentos por volumen!",
            promo_name="Negocio Premium",
            description="Para bares, restaurantes y hoteles.",
            original_price=900.0,
            promo_price=720.0,
            expiration_date=datetime(2026, 4, 30, 23, 59, 59),
            color_scheme="success"
        )
        db.session.add(promo2)
        db.session.flush()

        p_cubeta_10 = Product.query.filter_by(name="10 cubetas").first()
        if p_cubeta_10:
            db.session.add(PromotionItem(promotion_id=promo2.id, product_id=p_cubeta_10.id, quantity=1))

        # 3. Temporada de Raspados
        promo3 = Promotion(
            header_title="🍧 TEMPORADA DE RASPADOS",
            header_subtitle="¡Hielo perfecto para el verano!",
            promo_name="Paquete Verano",
            description="Textura perfecta para tus raspados.",
            original_price=500.0,
            promo_price=400.0,
            expiration_date=datetime(2026, 6, 30, 23, 59, 59),
            color_scheme="info"
        )
        db.session.add(promo3)
        db.session.flush()

        p_triturado_20 = Product.query.filter_by(name="20 kg").first()
        if p_triturado_20:
            db.session.add(PromotionItem(promotion_id=promo3.id, product_id=p_triturado_20.id, quantity=1))

        db.session.commit()
        print("Base de datos recreada, productos y promociones cargados con éxito.")

if __name__ == "__main__":
    seed_products()