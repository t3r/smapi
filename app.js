'use strict'

process.env.node_env = process.env.node_env || 'development'

const express = require('express');
const path = require('path');
const logger = require('morgan');
const bodyParser = require('body-parser');

const app = express();

const passport = require('passport');
require('./config/passport')(passport); // pass passport for configuration

const allowCrossDomain = function(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With');

    // intercept OPTIONS method
    if ('OPTIONS' == req.method) {
      res.sendStatus(200);
    }
    else {
      next();
    }
};

app.use(logger(process.env.node_env  === 'development' ? 'dev' : 'combined'));
app.use(require('helmet')())
app.use(require('compression')())
app.use(allowCrossDomain);
app.use(bodyParser.json({
  strict : true,
  limit:'5mb',
}))
app.use(passport.initialize())

//for local debugging only
if( process.env.node_env === 'development' )
  app.use(express.static('../smweb2/html'));


//app.use('/', require('./routes/far'));
//app.use('/ts', require('./routes/ts'));
app.use('/scenemodels', require('./routes/scenemodels'));
app.use('/auth', require('./routes/auth')(passport));

process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down');
  process.exit(0);
});

if( process.env.node_env === 'debug' ) {
  console.log("Running with environment", process.env );
}


module.exports = app;
