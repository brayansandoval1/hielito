from backend import create_app, db
from backend.models import Product

app = create_app()

@app.cli.command("init-db")
def init_db():
    db.create_all()
    print("Base de datos inicializada.")

if __name__ == '__main__':
    app.run(debug=True)