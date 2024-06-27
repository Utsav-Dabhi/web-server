import * as net from "net";

// promise-based API for TCP sockets
type TCPConn = {
  // the JS socket object
  socket: net.Socket;

  // from the 'error' event
  err: null | Error;

  // EOF, from the 'end' event
  ended: boolean;

  // the callbacks of the promise of the current read
  reader: null | {
    resolve: (value: Buffer) => void;
    reject: (reason: Error) => void;
  };
};

type TCPListener = {
  server: net.Server;
  connectionQueue: TCPConn[];
  waitingAccepts: ((conn: TCPConn) => void)[];
};

// wrapper from net.Socket
function socketInit(socket: net.Socket): TCPConn {
  const conn: TCPConn = {
    socket: socket,
    reader: null,
    err: null,
    ended: false,
  };

  socket.on("data", (data: Buffer) => {
    console.assert(conn.reader);

    // pause the 'data' event until next read
    conn.socket.pause();

    // fulfill promise of current read
    conn.reader!.resolve(data);
    conn.reader = null;
  });

  socket.on("end", () => {
    // this also fulfills current read
    conn.ended = true;

    if (conn.reader) {
      // EOF
      conn.reader.resolve(Buffer.from(""));
      conn.reader = null;
    }
  });

  socket.on("error", (err: Error) => {
    // errors are also delivered to current read
    conn.err = err;

    if (conn.reader) {
      conn.reader.reject(err);
      conn.reader = null;
    }
  });

  return conn;
}

function socketRead(conn: TCPConn): Promise<Buffer> {
  // no concurrent calls from same connection
  console.assert(!conn.reader);

  return new Promise((resolve, reject) => {
    // if connection is not readable, complete promise now
    if (conn.err) {
      reject(conn.err);
      return;
    }

    if (conn.ended) {
      // EOF
      resolve(Buffer.from(""));
      return;
    }

    // save promise callbacks
    conn.reader = { resolve: resolve, reject: reject };

    // resume 'data' event to fulfill promise later
    conn.socket.resume();
  });
}

function socketWrite(conn: TCPConn, data: Buffer): Promise<void> {
  console.assert(data.length > 0);

  return new Promise((resolve, reject) => {
    if (conn.err) {
      reject(conn.err);
      return;
    }

    conn.socket.write(data, (err?: Error) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function socketListen(
  server: net.Server,
  host: string,
  port: number
): TCPListener {
  const listener: TCPListener = {
    server: server,
    connectionQueue: [],
    waitingAccepts: [],
  };

  server.on("connection", (socket: net.Socket) => {
    const conn = socketInit(socket);
    if (listener.waitingAccepts.length > 0) {
      // If there's a waiting accept, fulfill it
      const accept = listener.waitingAccepts.shift()!;
      accept(conn);
    } else {
      // Otherwise, queue the connection
      listener.connectionQueue.push(conn);
    }
  });

  server.listen({ host, port }, () => {
    console.log("Server is listening on port 1234");
  });

  server.on("error", (err: Error) => {
    console.error("Server error:", err);
  });

  return listener;
}

function soAccept(listener: TCPListener): Promise<TCPConn> {
  return new Promise((resolve) => {
    if (listener.connectionQueue.length > 0) {
      // If there's a connection waiting, resolve immediately
      resolve(listener.connectionQueue.shift()!);
    } else {
      // Otherwise, add this accept request to the waiting queue
      listener.waitingAccepts.push(resolve);
    }
  });
}

async function handleConnections(listener: TCPListener) {
  while (true) {
    const conn = await soAccept(listener);

    // Handle each connection in a separate async function
    serveClient(conn).catch((err: Error) => {
      console.error("Error handling connection:", err);
    });
  }
}

async function serveClient(conn: TCPConn) {
  console.log(
    "New connection from ",
    conn.socket.remoteAddress + ":" + conn.socket.remotePort
  );

  while (true) {
    const data = await socketRead(conn);

    if (data.length === 0) {
      console.log("Closing connection");
      break;
    }

    console.log("data", data);
    await socketWrite(conn, data);
  }
}

function startServer() {
  const server = net.createServer({
    // required by `TCPConn`
    pauseOnConnect: true,
  });

  const listener: TCPListener = socketListen(server, "127.0.0.1", 1234);

  handleConnections(listener).catch((err: Error) => {
    console.error("Error in connection handler:", err);
  });
}

startServer();
