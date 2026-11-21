export function describeDatabaseFailure(error) {
  const codes = new Set();
  const visited = new Set();
  function inspect(cause) {
    if (!cause || visited.has(cause)) return;
    visited.add(cause);
    for (const value of [cause.name, cause.code, cause.codeName, cause.syscall]) {
      if (value !== undefined && /^[A-Za-z0-9_]+$/.test(String(value))) codes.add(String(value));
    }
    inspect(cause.cause);
    inspect(cause.error);
    if (cause.reason?.servers instanceof Map) {
      for (const server of cause.reason.servers.values()) inspect(server.error);
    }
  }
  inspect(error);
  let hint = "Check the database credentials, application egress IP and Atlas IP Access List.";
  if (codes.has("18") || codes.has("AuthenticationFailed")) hint = "Atlas rejected the database login. Check the database user's username and password.";
  else if (["querySrv", "queryTxt", "ENOTFOUND", "EAI_AGAIN"].some(code => codes.has(code))) hint = "DNS lookup failed. Check the cluster hostname and network DNS connection.";
  else if (["EACCES", "EPERM"].some(code => codes.has(code))) hint = "Local network access was denied. Retry from the normal Windows terminal.";
  else if (codes.has("ERR_SSL_TLSV1_ALERT_INTERNAL_ERROR")) hint = "TLS handshake failed. First compare Node's actual outgoing IP with Active Atlas IP Access List entries; the browser IP may differ. If they match, check the network TLS path.";
  return { codes: [...codes], hint };
}
