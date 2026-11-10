from flask import Flask, request
flask_app = Flask(__name__)
@flask_app.route("/")
def home():
    return "ok"
flask_app.run(host="0.0.0.0", port=8050)
