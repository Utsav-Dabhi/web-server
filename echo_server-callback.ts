import * as net from "net";

function newConnection(socket: net.Socket) {
  console.log(
    "New connection from ",
    socket.remoteAddress + ":" + socket.remotePort
  );
}

const server = net.createServer();

// throw err if something goes wrong
server.on("error", (err: Error) => {
  throw err;
});

// run the callback on new connection
server.on("connection", newConnection);

// bind and listen on the address and port
server.listen({ host: "127.0.0.1", port: 1234 });
