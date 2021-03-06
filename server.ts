import { Express } from 'express';

const express = require('express');
const app: Express = express();

const BicingApp = require('./apps/bicing-2021/index');
const BicingVueApp = require('./apps/bicing-vue/index');
const HomeApp = require('./apps/home/index');
const SlidesApp = require('./apps/slides/index');

app.use('/.well-known', express.static(__dirname + '/well-known-folder'));
app.use('/files', express.static(__dirname + '/public-files'));

app.use('/bicing/', BicingApp);
app.use('/bicing-vue/', BicingVueApp);
app.use('/slides/', SlidesApp);
app.use('/', HomeApp);

app.listen(8080, () => { console.log('Listening to 8080'); });
