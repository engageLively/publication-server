'''
An implementation of the publication server for Galyleo
'''

from json import dumps
import os

from google.cloud import datastore, storage
from flask import Flask, request, abort, jsonify
from flask_cors import CORS


datastore_client = datastore.Client()
storage_client = storage.Client()

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})


# query = datastore_client.query(kind='User')
# users = list(query.fetch())


def _list_blobs(bucket_name, prefix):
    """Lists all the blobs in the bucket."""
    # bucket_name = "your-bucket-name"

    # Note: Client.list_blobs requires at least package version 1.17.0.
    blobs = storage_client.list_blobs(bucket_name)

    # Note: The call returns a response only when the iterator is consumed.
    prefix_len = len(prefix) + 1
    return [blob.name[prefix_len:] for blob in blobs if blob.name.startswith(prefix) and len(blob.name) > prefix_len]

def _find_user(user):
    # find a user and return its record, or None
    canonical_user = user.lower()
    key = datastore_client.key('User', canonical_user)
    return datastore_client.get(key)


def _find_user_or_abort(user, route):
    # Find the user in the database or abort with a 400, explaining why
    record = _find_user(user)
    if record:
        return record
    abort(400, f'No user in the database with name {user}, route is {route}')


def _do_add_user(user_name):
    # A utility to add a user.  Key assumptions:
    # 1. The user doesn't exist in the database already
    # 2. This has been authorized (authentication is OK)
    # Parameters:
    #    user_name: name of the user to add
    # Returns:
    #    a JSON form of the entity created
    # should be a more efficient way to do this
    all_users = list(datastore_client.query(kind='User').fetch())
    counts = [record["count"] for record in all_users]
    max_count = max(counts)
    entity = datastore.Entity(datastore_client.key('User', user_name))
    entity['count'] = max_count + 1
    entity['userid'] = user_name
    datastore_client.put(entity)
    return jsonify(entity)

def _add_user_if_not_present(user_name):
    # Add user if not present in the database
    # Parameters:
    #    user_name: name of the user to add if not present
    # Returns: 
    #    None
    if _find_user(user_name) is None:
        _do_add_user(user_name)




@app.route("/add_user", methods=['POST'])
def add_user():
    '''
    Add the user to the datastore, and create a folder in the
    galyleo-user-dashboards bucket for his dashboards.  This
    should be called when the user is added to the Hub, to avoid realtime
    updates to the datastore
    Route parameters:
        -- user <string>
    '''
    # add the user to the users list, incrementing the count
    # create a folder in the bucket to host the user's dashboard
    user_name = request.form['user'].lower()
    if _find_user(user_name):
        abort(400, f'User {user_name} is already in the database')
    return _do_add_user(user_name)
    

def _user_folder_prefix(user_name, route):
    # return the prefix for the user bucket, to be searched
    user_record = _find_user_or_abort(user_name, route)
    return f'dashboards/{user_record["count"]}'

def _user_folder_prefix_or_default(user_name):
    # same as _user_folder_prefix, but returns 0 if there is no user by this name
    # used for anonymous publishing
    if user_name:
        user_record = _find_user(user_name)
        folder = user_record["count"] if user_record else 0
        return f'dashboards/{folder}'
    return 'dashboards/0'

@app.route("/list_user_dashboards/<user>")
def list_user_dashboards(user):
    '''
    Return a JSON list of all the dashboards published by the user.
    Route parameters:
        -- user <string>
    '''
    prefix = _user_folder_prefix_or_default(user)
    return _list_blobs('user-galyleo-dashboards', prefix)

def _make_url(blob_name):
    return f'https://galyleo.app/{blob_name}'

def _valid_secret(secret):
    # Return True iff secret is not none and it matches the secret
    # stored in the environment
    # Parameters: 
    # -- secret: the studio_secret passed in the body
    # Returns:
    # True iff secret is not None and the secret matches the secret in the environment
    if secret is None: return False
    stored_secret = os.environ['studio_secret'] if 'studio_secret' in os.environ else None
    if stored_secret is None: return False
    return stored_secret == secret

@app.route("/add_dashboard", methods=['POST'])
def add_user_dashboard():
    '''
    Add the dashboard value in the body of the post to the user's folder, under the name
    chosen by the user
    Route parameters (POST JSON body request):
        -- user <string>
        -- name <string>
        -- dashboard <JSON file>
    Optional parameters:
        -- studio_secret <string>
    '''
    content_type = request.headers.get('Content-Type')
    if content_type == 'application/json':
        request_body = request.json
    else:
        abort(400, '/add_dashboard requires a JSON body  with fields name and dashboard')
    required_fields = {"name", "dashboard"}
    missing = required_fields.difference(request_body.keys())
    if len(missing) > 0:
        abort(400, f'/add_dashboard body missing required fields {missing}')
    user_name = request_body['user'] if "user" in request_body.keys() else None
    studio_secret = request_body['studio_secret'] if 'studio_secret' in request_body.keys() else None
    if _valid_secret(studio_secret) and user_name is not None:
        _add_user_if_not_present(user_name)
    prefix = _user_folder_prefix_or_default(user_name)
    # checks: we should make sure that name is a valid part of a file name
    # we should make sure that dashboard is a valid table
    # for now, just write and have done with it...
    blob_name = f'{prefix}/{request_body["name"]}'
    bucket = storage_client.get_bucket('user-galyleo-dashboards')
    blob = bucket.blob(blob_name)
    blob.upload_from_string(dumps(request_body['dashboard']), content_type='application/json')
    return _make_url(blob_name)


def _get_name_from_request(route):
    user_name = request.args.get('user')
    dashboard_name = request.args.get('name')
    if dashboard_name:
        return f'{_user_folder_prefix_or_default(user_name)}/{dashboard_name}'
    else:
        abort(400, f'name is a required parameter for route {route}')


@app.route("/get_dashboard")
def get_dashboard():
    '''
    Return the dashboard for the user given by the name parameter, as a JSON string
    Route parameters:
        -- user <string>
        -- name <string>
    '''

    blob_name = _get_name_from_request('/get_dashboard')
    # bucket = storage_client.bucket('user-galyleo-dashboards')
    return blob_name


@app.route("/get_dashboard_url")
def get_dashboard_link():
    '''
    Return the URL for the  dashboard for the user given by the name parameter
    Route parameters:
        -- user <string>
        -- name <string>
    '''
    blob_name = _get_name_from_request('/get_dashboard_url')
    return f'https://galyleo.app/{blob_name}'



@app.route("/delete_dashboard", methods=['POST'])
def delete_dashboard():
    '''
    Delete the  dashboard for the user given by the name parameter
    Route parameters (POST body request):
        -- user <string>
        -- name <string>
    '''
    return 'not yet implemented'
    

@app.route("/get_studio_url")
def _get_studio_url():
    '''
    Get the URL to use for the dashboard studio, depending on the hub and the 
    language. This should be driven by the datastore, and someday it will be;
    but for now, just return the standard for everything except localhost and 
    galyleobeta, which will always default to the experimental dashboards
    '''

    suffix = 'jp' if 'language' in request.args and request.args.get('language').startswith('ja') else 'en'
    base = 'https://matt.engagelively.com/users/rick/published'
    use_beta = {'localhost', 'galyleojupyter-beta'}
    middle = 'studio-beta' if ('hub' not in request.args) or (request.args.get('hub') in use_beta) else 'studio'
    return f'{base}/{middle}-{suffix}/index.html'
    

@app.route('/')
@app.route('/routes')
def show_routes():
    '''
    Return the routes of this server as a JSON structure
    '''
    return jsonify({
        '/, /routes': {
            "method": 'GET',
            "parameters": [],
            "side effects": "None",
            "returns": "Dictionary of routes as a JSON object",
            "errors": "None"
        },
        '/add_user': {"method": 'POST',
            "parameters": ["user"],
            "side effects": "adds the user to the database and increments the user count",
            "returns": "User name and number as a JSON dictionary",
            "errors": "400 if the user exists"},
        '/list_user_dashboards/<user>': {
            "method": 'GET',
            "parameters":[],
            "side effects": "None",
            "returns": "Return a JSON list of all the dashboards published by the user.",
            "errors": "400 if the user doesn't exist"
        },
        '/add_dashboard': {
            "method": 'POST',
            "parameter-passing": "JSON body",
            "parameters": ["user", "name", "studio_secret", "body"],
            "side effects": "Add the dashboard value in the body of the post to the user's folder, under the name chosen by the user, overwriting if the dashboard exists.  Adds the user if the user isn't there, the studio_secret is present and set to the correct value",
            "returns": "The URL of the dashboard",
            "errors": "400 if the user doesn't exist and the studio_secret is not present and not set to the correct value"
        },
        '/get_dashboard/': {
            "method": "GET",
            "parameters": ["user", "name"],
            "side effects": "None",
            "returns": "The dashboard as a JSON string",
            "errors": "400 if the user or dashboard of that name doesn't exist"
        },
        '/get_dashboard_link/': {"method": 'GET',
            "parameters": ["user",
            "name"],
            "side effects": "None",
             "returns": "The URL of the  dashboard as string",
            "errors": "400 if the user or dashboard of that name doesn't exist"
        },
        '/delete_dashboard': {"method": 'POST',
            "parameters": ["user",
            "name" ],
            "side effects": "Deletes the dashboard from the user's folder",
             "returns": "The name of the deleted dashboard",
            "errors": "400 if the user doesn't exist or the dashboard doesn't exist"
        },
        '/get_studio_url': {"method": "GET",
            "parameters": ["hub", "language"],
            "side effects": "none",
            "returns": "the URL to use for the studio",
            "errors": "None"
        }

    })


if __name__ == "__main__":
    app.run(debug = True, threaded = True, host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
    # app.run(threaded = True)
