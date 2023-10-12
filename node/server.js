const express = require('express');
const { Datastore } = require('@google-cloud/datastore');
const { Storage } = require('@google-cloud/storage');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 8080;

const datastore = new Datastore();
const storage = new Storage();

app.use(bodyParser.json());

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

function listBlobs(bucketName, prefix) {
  const options = {
    prefix: prefix,
  };

  return storage.bucket(bucketName).getFiles(options)
    .then(([files]) => {
      return files.map(file => file.name.split('/').pop());
    });
}

function findUser(userName) {
  const key = datastore.key(['User', userName.toLowerCase()]);
  return datastore.get(key)
    .then(([entity]) => entity);
}

function addUserIfNotPresent(userName) {
  return findUser(userName)
    .then(entity => {
      if (!entity) {
        return datastore.runInTransaction(transaction => {
          const query = datastore.createQuery('User').select(['count']).order('count', { descending: true }).limit(1);

          return datastore.runQuery(query)
            .then(([results]) => {
              const maxCount = results.length > 0 ? results[0].count : 0;
              const userKey = datastore.key(['User', userName.toLowerCase()]);
              const userEntity = {
                key: userKey,
                data: {
                  count: maxCount + 1,
                  userid: userName,
                },
              };
              transaction.save(userEntity);
              return transaction.commit()
                .then(() => userEntity);
            });
        });
      }
    });
}

app.post('/add_user', (req, res) => {
  const userName = req.body.user.toLowerCase();

  findUser(userName)
    .then(entity => {
      if (entity) {
        res.status(400).json({ error: `User ${userName} is already in the database` });
      } else {
        addUserIfNotPresent(userName)
          .then(userEntity => {
            res.json(userEntity);
          });
      }
    });
});

app.get('/list_user_dashboards/:user', (req, res) => {
  const prefix = req.params.user ? `dashboards/${req.params.user}` : 'dashboards/0';

  listBlobs('user-galyleo-dashboards', prefix)
    .then(blobs => {
      res.json(blobs);
    });
});

app.post('/add_dashboard', (req, res) => {
  const { user, name, dashboard, studio_secret } = req.body;

  if (!user || !name || !dashboard) {
    res.status(400).json({ error: '/add_dashboard requires user, name, and dashboard fields in the request body' });
    return;
  }

  if (studio_secret && studio_secret === process.env.studio_secret) {
    addUserIfNotPresent(user)
      .then(() => {
        const prefix = user ? `dashboards/${user}` : 'dashboards/0';
        const blobName = `${prefix}/${name}`;
        const bucket = storage.bucket('user-galyleo-dashboards');
        const blob = bucket.file(blobName);

        blob.save(JSON.stringify(dashboard), { contentType: 'application/json' })
          .then(() => {
            res.json({ url: `https://galyleo.app/${blobName}` });
          })
          .catch(err => {
            res.status(500).json({ error: err.message });
          });
      });
  } else {
    res.status(400).json({ error: 'Invalid studio_secret' });
  }
});

app.get('/get_dashboard/:user/:name', (req, res) => {
  const blobName = getBlobNameFromRequest(req);
  res.status(200).json({ message: 'Not yet implemented' });
});

app.get('/get_dashboard_url/:user/:name', (req, res) => {
  const blobName = getBlobNameFromRequest(req);
  res.json({ url: `https://galyleo.app/${blobName}` });
});

app.post('/delete_dashboard', (req, res) => {
  res.status(200).json({ message: 'Not yet implemented' });
});

app.get('/get_studio_url', (req, res) => {
  const suffix = req.query.language && req.query.language.startsWith('ja') ? 'jp' : 'en';
  const useBeta = new Set(['localhost', 'galyleojupyter-beta']);
  const middle = useBeta.has(req.query.hub) ? 'studio-beta' : 'studio';
  const url = `https://matt.engagelively.com/users/rick/published/${middle}-${suffix}/index.html`;
  res.json({ url });
});

function getBlobNameFromRequest(req) {
  const user = req.params.user;
  const name = req.params.name;

  if (!name) {
    throw new Error('name is a required parameter for this route');
  }

  return user ? `dashboards/${user}/${name}` : `dashboards/0/${name}`;
}

// Define a function to return the routes information
function getRoutesInfo(req, res) {
  res.json({
    '/, /routes': {
      method: 'GET',
      parameters: [],
      side_effects: 'None',
      returns: 'Dictionary of routes as a JSON object',
      errors: 'None',
    },
    '/add_user': {
      method: 'POST',
      parameters: ['user'],
      side_effects: 'adds the user to the database and increments the user count',
      returns: 'User name and number as a JSON dictionary',
      errors: '400 if the user exists',
    },
    '/list_user_dashboards/:user': {
      method: 'GET',
      parameters: [],
      side_effects: 'None',
      returns: 'Return a JSON list of all the dashboards published by the user.',
      errors: '400 if the user doesn\'t exist',
    },
    '/add_dashboard': {
      method: 'POST',
      parameter_passing: 'JSON body',
      parameters: ['user', 'name', 'studio_secret', 'body'],
      side_effects: 'Add the dashboard value in the body of the post to the user\'s folder, under the name chosen by the user, overwriting if the dashboard exists. Adds the user if the user isn\'t there, the studio_secret is present and set to the correct value',
      returns: 'The URL of the dashboard',
      errors: '400 if the user doesn\'t exist and the studio_secret is not present and not set to the correct value',
    },
    '/get_dashboard/:user/:name': {
      method: 'GET',
      parameters: ['user', 'name'],
      side_effects: 'None',
      returns: 'The dashboard as a JSON string',
      errors: '400 if the user or dashboard of that name doesn\'t exist',
    },
    '/get_dashboard_url/:user/:name': {
      method: 'GET',
      parameters: ['user', 'name'],
      side_effects: 'None',
      returns: 'The URL of the dashboard as a string',
      errors: '400 if the user or dashboard of that name doesn\'t exist',
    },
    '/delete_dashboard': {
      method: 'POST',
      parameters: ['user', 'name'],
      side_effects: 'Deletes the dashboard from the user\'s folder',
      returns: 'The name of the deleted dashboard',
      errors: '400 if the user doesn\'t exist or the dashboard doesn\'t exist',
    },
    '/get_studio_url': {
      method: 'GET',
      parameters: ['hub', 'language'],
      side_effects: 'none',
      returns: 'the URL to use for the studio',
      errors: 'None',
    },
    '/routes': {
      method: 'GET',
      parameters: [],
      side_effects: 'None',
      returns: 'Dictionary of routes as a JSON object',
      errors: 'None',
    },
  });
}

// Set up the combined routes for '/' and '/routes'
app.get(['/', '/routes'], getRoutesInfo);

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
