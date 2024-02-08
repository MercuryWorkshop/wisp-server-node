/** Wisp server node!
 * Made by Rafflesia@\MercuryWorkshop
 * 
 * This software is licensed under AGPLv3 &&
 * You should have a copy of AGPLv3 with this source code
 * 
 * This implimentation of wisp is sort of really broken 
 * so I set the buffer size to max 32bit int, 
 * I'm not sure why it doesn't work with lower values
 * 
 */


import { WebSocketServer } from 'ws';
import wisp from './wisp';

const wss = new WebSocketServer({
  port: 3000
});



wss.on('connection', ws => {
    wisp.routeRequest(ws)
});