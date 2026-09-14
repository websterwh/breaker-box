# breaker-box-watcher

A small background service, installed by the plugin's `.deb` package,
that watches one Docker container and updates a Breaker Box Worker's
`MODE`/message secrets when it restarts - **independent of any browser
tab**, unlike checking from the plugin's page directly.

It's a single dependency-free Node script (`watcher.js`) run via a
standard LSB init.d script (`breaker-box-watcher.init`, modeled on MOS's
own `/etc/init.d/api`), since this MOS install uses SysV-style init, not
systemd.

## How it gets its config

It reads the plugin's own saved settings directly from disk:

```
/boot/optional/plugins/breaker-box/settings.json
```

This path isn't documented by MOS - it was found by inspecting a live
install (MOS's plugin-settings API is described as reading/writing
"settings.json", and this is where it actually lands). **A future MOS
version could change this path**, in which case the watcher will just
log `Couldn't read settings` and stay idle - it never fails loudly or
touches your Worker in that case. If updates ever stop taking effect,
this is the first thing to check.

No MOS API token or authentication of any kind is needed - it reads the
file directly and talks to Docker over its local socket
(`/var/run/docker.sock`), both because this runs as root on the same
host.

## What it does

Every 10 seconds (only when the plugin's settings have a Worker fully
configured and a "Container to watch" selected):

1. Checks the named container's live state via `/containers/json` on
   Docker's local socket.
2. On seeing it enter `"restarting"`: pushes `RESTART_TITLE` with the
   real container name, sets the `MODE` secret to `R`, and pushes a
   `CONTAINER_WATCH_AT` timestamp - all through the Worker's built-in
   `/__bbproxy` relay, using the same Cloudflare API token you entered in
   the plugin.
3. While still restarting: refreshes `CONTAINER_WATCH_AT` each cycle -
   see [worker/README.md](../worker#optional-live-container-aware-restart-detection)
   for what the Worker does with that.
4. Once Docker reports it `"running"` again: reverts `RESTART_TITLE` to
   whatever you've set in the plugin's Messages panel (or the Worker's
   default if you haven't), clears `MODE`, and removes
   `CONTAINER_WATCH_AT`.

If the container isn't selected, or the Worker connection settings are
incomplete, it just stays idle - the same as before this feature existed.

## Logs

`/var/log/breaker-box-watcher` (matches MOS's own `/etc/init.d/api`
convention for where it sends output).

## Managing it manually

```
/etc/init.d/breaker-box-watcher {start|stop|restart|status}
```

The plugin's package installs and starts it automatically, and removes
it on uninstall.
