from app import app, db
from backend.models import User, Order, Product, Category, Promotion
from sqlalchemy import inspect, text

def show_summary():
    with app.app_context():
        print("\n=== RESUMEN DE BASE DE DATOS ===")
        
        # Listar todas las tablas físicas en la DB
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()
        print(f"Tablas encontradas: {', '.join(tables)}")

        print(f"\n--- DETALLE DE REGISTROS ---")
        print(f"USUARIOS: {User.query.count()}")
        for u in User.query.all():
            print(f" - {u.username} [{u.email}]")

        print(f"\nCATEGORÍAS: {Category.query.count()}")
        print(f"PRODUCTOS EN STOCK:")
        for p in Product.query.all():
            print(f" - {p.name}: {p.stock} unidades")

        print(f"\nPROMOCIONES VIGENTES: {Promotion.query.count()}")

        print(f"\nÚLTIMOS PEDIDOS ({Order.query.count()}):")
        for o in Order.query.order_by(Order.created_at.desc()).limit(5).all():
            print(f" - Pedido #{o.id}: Total: ${o.total} - Estatus: {o.status}")

if __name__ == "__main__":
    show_summary()