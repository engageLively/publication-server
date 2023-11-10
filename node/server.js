const express = require('express');

const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs')

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.static('static'))

// const cors = require('cors');
/// app.use(cors)
app.use(bodyParser.json());

//
// Set up CORS permissions so we don't run into refusals
//

app.use(function(req, res, next) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
  next();
});

// Settings for directories for dashboard on the server and the server URL.  These should probably
// move to a configuration file


const directoryPath = 'static/dashboards'; // Replace with the path to the directory you want to list
const url = 'http://localhost:8080'
const publishUrl = `${url}/published/index.html`
const dashboardUrl  = `${url}/dashboards`

/**
 * List the published dashboards.  This is a GET method, no parameters.
 * Note that there is no authentication in this server yet -- we will add authentication
 * to suit customers' preferences on an individual basis
 */


app.get('/list_dashboards/', (req, res) => {
  fs.readdir(directoryPath, (err, fileList) => {
    if (err) {
      console.error(`Error reading ${directoryPath}: err`);
      res.status(500).send('Failed to read dashboard directory, error has been reported')
    } else {
      const dashboards = fileList.filter(fileName => fileName.endsWith('.gd.json'))
      res.status(200).json(dashboards)
    }
  })
});

/**
 * Add a dashboard to the dashboards directory.  
 * POST request
 * parameters:
 *     studio_secret: a token indicating that this request is coming from the dashboard editor
 *     name: name of the dashboard file
 *     dashboard: the dashboard data structure in JSON format
 */

app.post('/add_dashboard', (req, res) => {
  const { name, dashboard, studio_secret } = req.body;

  if (!name || !dashboard) {
    res.status(400).json({ error: '/add_dashboard requires name and dashboard fields in the request body' });
    return;
  }

  if (studio_secret && studio_secret === process.env.studio_secret) {
    const filePath = `${directoryPath}/${name}`;
    const json = JSON.stringify(dashboard);
    fs.writeFile(filePath, json, (err) => {
      if (err) {
        console.error(`Error writing ${filePath}: err`);
        res.status(500).send('Failed to write  to dashboard directory, error has been reported')
      } else {
        dashboardFile = `${dashboardUrl}/${name}`
        res.status(200).json({
          'dashboard': dashboardFile,
          'view': `${publishURL}?dashboard=${dashboardFile}`
        })

      }
    });
    /* Store dashboard as the file under fileName */
  } else {
    res.status(400).json({ error: 'Invalid studio_secret' });
  }
});




app.use('/static', (req, res, next) => {  
  const requestedPath = path.join(__dirname, 'static', req.url);
  console.log('Requested Path:', requestedPath);

  try {
    if (fs.statSync(requestedPath).isDirectory()) {
      const indexPath = path.join(requestedPath, 'index.html');
      console.log('Index Path:', indexPath);
      
      if (fs.existsSync(indexPath)) {
        console.log('Sending Index File:', indexPath);
        return res.sendFile(indexPath);
      }
    }
  } catch (error) {
    console.error('Error occurred:', error);
  }

  console.log('Serving Static Files:', requestedPath);
  express.static(path.join(__dirname, 'static'))(req, res, next);
});




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
    
    '/list_dashboards/': {
      method: 'GET',
      parameters: [],
      side_effects: 'None',
      returns: 'Return a JSON list of all the dashboards published .',
      
    },
    '/add_dashboard': {
      method: 'POST',
      parameter_passing: 'JSON body',
      parameters: ['name', 'studio_secret', 'dashboard'],
      side_effects: 'Add the dashboard value in the body of the post to the dashboard folder, under name, overwriting if the dashboard exists. Adds the user if the user isn\'t there, the studio_secret is present and set to the correct value',
      returns: 'The URL of the dashboard ahd the URL of the published page',
      errors: '400 if the studio_secret is not present or not set to the correct value',
    },
    '/get_dashboard/:name': {
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
      parameters: ['name'],
      side_effects: 'Deletes the dashboard from the user\'s folder',
      returns: 'The name of the deleted dashboard',
      errors: '400 if the  dashboard doesn\'t exist',
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
