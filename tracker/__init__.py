"""Price tracker: scrapers, storage, collection scheduler and API."""

import socket as _socket

import urllib3.util.connection as _conn

# Some networks resolve sites to IPv6 addresses but cannot route IPv6: every
# request then stalls until it falls back (measured: 82 s -> 2.5 s for one
# call). Use IPv4 for all outgoing requests made by the tracker.
_conn.allowed_gai_family = lambda: _socket.AF_INET

"""Price Watch: track two rival products' prices over time for signs of coordination."""
