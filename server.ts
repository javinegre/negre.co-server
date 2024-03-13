import { Express } from 'express';

const express = require('express');
const app: Express = express();

const BicingApi = require('./apis/bicing-api/index');

const BicingApp = express.static(__dirname + '/apps/bicing-2023/dist');
const Bicing2021App = require('./apps/bicing-2021/index');
const BicingVueApp = require('./apps/bicing-vue/index');
const HomeApp = require('./apps/home/index');
const SlidesApp = require('./apps/slides/index');

app.use('/.well-known', express.static(__dirname + '/well-known-folder'));
app.use('/files', express.static(__dirname + '/public-files'));

app.use('/bicing/api/', BicingApi);
app.use('/bicing/', BicingApp);
app.use('/bicing-2021/', Bicing2021App);
app.use('/bicing-vue/', BicingVueApp);
app.use('/slides/', SlidesApp);
app.use('/', HomeApp);

app.listen(8080, () => { console.log('Listening to 8080'); });
