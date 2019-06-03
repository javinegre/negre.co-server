const express = require('express');
const app = express();

const BicingApp = require('./apps/bicing-vue/index');
const HomeApp = require('./apps/home/index');
const SlidesApp = require('./apps/slides/index');

app.use('/.well-known', express.static(__dirname + '/well-known-folder'));

app.use('/bicing/', BicingApp);
app.use('/slides/', SlidesApp);
app.use('/', HomeApp);

app.listen(8080, () => { console.log('Listening to 8080'); });
