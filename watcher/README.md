# breaker-box-watcher

A small background service, installed by the plugin's `.deb` package,
that watches your Docker containers and updates a Breaker Box Worker's
`MODE`/message secrets when one restarts - **independent of any browser
tab**, unlike checking from the plugin's page directly. By default it
watches every container on the host; the plugin's Settings has an
optional dropdown to restrict it to just one.

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

Reacts to Docker's own event stream (`/events` on Docker's local socket)
the instant a container actually stops or starts - not on a delay. A
fast restart can complete entirely between two samples of a periodic
poll, so events are the primary trigger; a 10-second poll runs alongside
purely as a safety net (reconnecting the event stream if it drops,
catching anything missed, and refreshing `CONTAINER_WATCH_AT` even when
nothing's changing). Only when the plugin's settings have a Worker fully
configured:

1. Lists every container's live state via `/containers/json` on Docker's
   local socket - all of them, unless a specific container is selected in
   the plugin's Settings - and tracks each one's state from tick to tick.
   Any container going from `"running"` to anything else counts as
   restarting, not just the literal `"restarting"` state: that state only
   applies when a restart *policy* is auto-recovering a crashed
   container, and a manual restart (MOS's own Restart button, `docker
   restart`, etc.) just stops and starts it directly, usually without
   Docker ever reporting `"restarting"` at all. A container already
   stopped when this service starts is never mistaken for one that just
   started restarting, since there's no prior "running" observation to
   compare against.
2. If any are restarting: pushes `RESTART_TITLE` naming them (e.g. "plex
   is restarting", or "plex, sonarr are restarting" if more than one is
   restarting at once), sets the `MODE` secret to `R`, and pushes a
   `CONTAINER_WATCH_AT` timestamp - all through the Worker's built-in
   `/__bbproxy` relay, using the same Cloudflare API token you entered in
   the plugin. `RESTART_TITLE`/`MODE` are only re-pushed when the set of
   restarting containers actually changes; `CONTAINER_WATCH_AT` refreshes
   every cycle regardless, since that's what tells the Worker this is
   still a live, current signal - see
   [worker/README.md](../worker#optional-live-container-aware-restart-detection)
   for what it does with that.
3. Once none are restarting: reverts `RESTART_TITLE` to whatever you've
   set in the plugin's Messages panel (or the Worker's default if you
   haven't), clears `MODE`, and removes `CONTAINER_WATCH_AT`.
4. If a container's been "restarting" for more than 20 minutes straight,
   it's probably not actually coming back - the watcher stops treating it
   as one and lets the Worker's own elapsed-time Offline behavior take
   over, rather than showing "restarting" forever for something that's
   really just stopped.

If the Worker connection settings are incomplete, it just stays idle -
the same as before this feature existed. A single Worker only fronts one
site, so all watched containers share that one Worker's `MODE`/messages -
if you run separate Workers for separate sites, each needs its own
plugin settings (and this watcher reads only one settings file, so
multi-Worker setups aren't covered by a single install of this service).

## Logs

`/var/log/breaker-box-watcher` (matches MOS's own `/etc/init.d/api`
convention for where it sends output).

## Managing it manually

```
/etc/init.d/breaker-box-watcher {start|stop|restart|status}
```

The plugin's package installs and starts it automatically, and removes
it on uninstall.
