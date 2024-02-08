import { WebSocketServer } from 'ws';
import wisp from './ConnectionHandler';

const wss = new WebSocketServer({
  port: 3000
});



wss.on('connection', ws => {
    wisp.routeRequest(ws)
});