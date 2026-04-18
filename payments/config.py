import os
def payment_config(app):
    app.config['STRIPE_SECRET_KEY'] = os.getenv('STRIPE_API_KEY')
    app.config['STRIPE_PUBLISHABLE_KEY'] = 'pk_test_51TNfxTPYbgBc47qk5E2eNmouiW953bjDBM6JTgVEsWhPnzndfBKqo8GborKL5amj5lOiv1pSSrkWRsw9EK9RWgjk00e3can8Dd'