from setuptools import setup, find_packages

setup(
    name='backend',
    version='0.1.0',
    packages=find_packages(),
    install_requires=[
        'Flask==2.3.3',
        'Flask-SQLAlchemy==3.0.5',
        'Flask-Migrate==4.0.5',
        'Flask-CORS==4.0.0',
        'Flask-JWT-Extended==4.5.3',
        'Flask-Mail==0.9.1',
        'Werkzeug==2.3.7',
        'python-dotenv==1.0.0',
        'stripe==15.0.1',
        'psycopg2-binary==2.9.9',
        'google-auth>=2.20.0',
        'google-auth-oauthlib>=1.0.0',
        'google-auth-httplib2>=0.1.0'
    ],
    include_package_data=True,
    zip_safe=False
)