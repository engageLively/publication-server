const express = require('express');
const { Datastore } = require('@google-cloud/datastore');
const { Storage } = require('@google-cloud/storage');
const bodyParser = require('body-parser');
const cors = require('cors');
const { json } = require('body-parser');

const datastore = new Datastore();
const storage = new Storage();

const app = express();
app.use(cors());

app.use(bodyParser.json());

const listBlobs = (bucketName, prefix) => {
  return new Promise((resolve, reject) => {
    const bucket = storage.bucket(bucketName);
    const options = {
      prefix: prefix,
    };

    bucket.getFiles(options, (err, files) => {
      if (err) {
        reject(err);
      } else {
        const blobNames = files.map((file) => file.name);
        const prefixLen = prefix.length + 1;
        const result = blobNames
          .filter((name) => name.startsWith(prefix) && name.length > prefixLen)
          .map((name) => name.slice(prefixLen));
        resolve(result);
      }
    });
  });
};

const findUser = (user) => {
  const canonicalUser = user.toLowerCase();
  const key = datastore.key(['User', canonicalUser]);
  return datastore.get(key);
};

const addNewUser = (userName) => {
  return new Promise(async (resolve, reject) => {
    try {
      const query = datastore.createQuery('User');
      const [entities] = await datastore.runQuery(query);
      const counts = entities.map((entity) => entity.count);
      const maxCount = Math.max(...counts);

      const entity = {
        key: datastore.key(['User', userName]),
        data: {
          count: maxCount + 1,
          userid: userName,
        },
      };

      await datastore.upsert(entity);
      resolve(entity);
    } catch (error) {
      reject(error);
    }
  });
};

const addNewUserIfNotPresent = (userName) => {
  return new Promise(async (resolve, reject) => {
    try {
      const user = await findUser(userName);
      if (!user) {
        const newUser = await addNewUser(userName);
        resolve(newUser);
      } else {
        resolve(user);
      }
    } catch (error) {
      reject(error);
    }
  });
};

app.post('/add_user', async (req, res) => {
  const { user } = req.body;
  const userName = user.toLowerCase();

  try {
    const existingUser = await findUser(userName);
    if (existingUser) {
      return res.status(400).json({ error: `User ${userName} is already in the database` });
    }

    const newUser = await addNewUser(userName);
    res.json(newUser);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/list_user_dashboards/:user', async (req, res) => {
  const { user } = req.params;
  const prefix = user ? `dashboards/${user}` : 'dashboards/0';

  try {
    const blobs = await listBlobs('user-galyleo-dashboards', prefix);
    res.json(blobs);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Add other routes following the same structure

const port = process.env.PORT || 8080;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
