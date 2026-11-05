import http from "node:http";
const port = Number(process.env.PORT || 3000);
const server = http.createServer((req,res) => {
  if (req.url === "/health/ready" || req.url === "/health") {
    res.writeHead(200, {"content-type":"application/json"});
    res.end(JSON.stringify({ok:true,service:"apollo-node-3-bootstrap"}));
    return;
  }
  res.writeHead(200, {"content-type":"text/plain"});
  res.end("ApolloStation Node 3 bootstrap resource is ready.\n");
});
server.listen(port, "0.0.0.0");
