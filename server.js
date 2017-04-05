const express = require('express'),
  app = express();

const HomeApp = require('./apps/home/index');
  // InteranualApp = require('./apps/interanual/index');
  // SlidesApp = require('./apps/slides/index');

// app.use('/interanual/', InteranualApp);
// app.use('/slides/', SlidesApp);
app.use('/', HomeApp);

app.listen(8080, () => { console.log('Listening to 8080'); });