<template>
  <div class="breaker-box">
    <div class="toolbar">
      <h1>Breaker Box</h1>
      <div class="toolbar-right">
        <button class="btn" @click="checkSecretExists" :disabled="!configComplete || checking">
          {{ checking ? 'Checking…' : 'Refresh status' }}
        </button>
        <button class="btn btn-icon" @click="openMessages" title="Messages" aria-label="Messages">✎</button>
        <button class="btn btn-icon" @click="openSettings" title="Settings" aria-label="Settings">⚙</button>
      </div>
    </div>

    <label class="global-toggle">
      <span class="switch">
        <input type="checkbox" v-model="form.autoFeaturesEnabled" @change="applyAutoFeaturesToggle" />
        <span class="switch-track"><span class="switch-thumb"></span></span>
      </span>
      <span class="global-toggle-text">
        Auto features on
        <small>Background container watch, the Worker's automatic Restarting/Offline pages when it's unreachable, and auto-push of Worker code on update. Off means only the manual buttons and panels ever act.</small>
      </span>
    </label>

    <div v-if="!configComplete" class="banner banner-warn">
      Not configured yet. Open Settings (⚙) and fill in your Worker URL, Cloudflare API
      token, Account ID, and Worker script name.
    </div>

    <div v-if="error" class="banner banner-warn" role="alert">{{ error }}</div>
    <div v-if="successMessage" class="banner banner-ok" role="status">{{ successMessage }}</div>

    <div v-if="configComplete" class="status-card">
      <div class="status-row">
        <span class="label">Secret on Worker</span>
        <span :class="['badge', secretExists === true ? 'badge-set' : secretExists === false ? 'badge-clear' : 'badge-unknown']">
          {{ secretExists === true ? 'SET' : secretExists === false ? 'NOT SET' : 'UNKNOWN' }}
        </span>
      </div>
      <div class="status-row">
        <span class="label">Last set from this plugin</span>
        <span class="value">
          <template v-if="lastKnownState.value">
            {{ modeLabel(lastKnownState.value) }} ({{ fmtAge(lastKnownState.setAt) }})
          </template>
          <template v-else>—</template>
        </span>
      </div>
      <div class="status-row" v-if="lastKnownState.revertAt">
        <span class="label">Auto-reverts</span>
        <span class="value">{{ fmtRevertAt(lastKnownState.revertAt) }}</span>
      </div>
      <div class="status-row" v-if="messagesPushedAt">
        <span class="label">Messages last pushed</span>
        <span class="value">{{ fmtAge(messagesPushedAt) }}</span>
      </div>
      <div class="status-row">
        <span class="label">Watching containers</span>
        <span class="value">{{ form.containerName || 'All containers' }} (background service)</span>
      </div>
    </div>

    <label class="timer-field" v-if="configComplete">
      <span>Auto-revert to Normal after</span>
      <select v-model.number="revertMinutes">
        <option :value="0">None</option>
        <option :value="5">5 minutes</option>
        <option :value="15">15 minutes</option>
        <option :value="30">30 minutes</option>
        <option :value="60">1 hour</option>
        <option :value="180">3 hours</option>
      </select>
    </label>

    <div class="button-row">
      <button class="btn btn-off" :disabled="!configComplete || busy" @click="setMode('off')">
        {{ busy === 'off' ? 'Clearing…' : 'Normal' }}
      </button>
      <button class="btn btn-restart" :disabled="!configComplete || busy" @click="setMode('R')">
        {{ busy === 'R' ? 'Setting…' : 'Restarting' }}
      </button>
      <button class="btn btn-maint" :disabled="!configComplete || busy" @click="setMode('M')">
        {{ busy === 'M' ? 'Setting…' : 'Under Maintenance' }}
      </button>
    </div>

    <div v-if="showSettings" class="modal-backdrop" @click.self="closeModals" @keydown.esc="closeModals">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <h2 id="settings-title">Settings</h2>

        <label class="field">
          <span>Worker URL</span>
          <input v-model="form.workerUrl" type="text" placeholder="https://breaker-box-worker.you.workers.dev" />
          <small>Your deployed Worker. It handles both site traffic and the plugin's Cloudflare API calls.</small>
        </label>

        <label class="field">
          <span>Cloudflare API Token</span>
          <input v-model="form.apiToken" type="password" placeholder="your Cloudflare API token" />
          <small>Needs "Edit Cloudflare Workers" permission.</small>
        </label>

        <label class="field">
          <span>Account ID</span>
          <input v-model="form.accountId" type="text" placeholder="Cloudflare account ID" />
        </label>

        <label class="field">
          <span>Worker Script Name</span>
          <input v-model="form.scriptName" type="text" placeholder="e.g. breaker-box-worker" />
          <small>
            Auto-filled from the Worker URL above when it's a *.workers.dev address.
            Using a custom domain instead? Enter the script name yourself — it's shown
            in the Cloudflare dashboard next to your Worker.
          </small>
        </label>

        <label class="field">
          <span>Secret Name</span>
          <input v-model="form.secretName" type="text" placeholder="MODE" />
        </label>

        <div class="msg-group">
          <h3>Container watch (optional)</h3>
          <p class="modal-intro">
            A background service (installed alongside this plugin, runs independently
            of this browser tab) watches your Docker containers every few seconds —
            when it sees one actually restarting, it shows the real container name(s)
            instead of a generic message and keeps showing "Restarting" for as long as
            a restart is confirmed still happening, not just for a fixed 15 minutes.
            By default it watches every container on this host; pick one below to
            restrict it to just that container instead. See
            <a href="https://github.com/websterwh/breaker-box/tree/main/watcher" target="_blank" rel="noopener">watcher/README.md</a>
            for how it works and its logs.
          </p>
          <label class="field">
            <span>Container to watch</span>
            <div class="field-with-button">
              <select v-model="form.containerName">
                <option value="">All containers</option>
                <option v-for="name in containerOptions" :key="name" :value="name">{{ name }}</option>
              </select>
              <button type="button" class="btn" :disabled="loadingContainers" @click="loadContainerOptions">
                {{ loadingContainers ? 'Loading…' : 'Refresh list' }}
              </button>
            </div>
            <small v-if="containerOptionsError" class="watch-error">{{ containerOptionsError }}</small>
          </label>
        </div>

        <div class="msg-group">
          <h3>Worker code</h3>
          <p class="modal-intro">
            Pushes the plugin's bundled copy of the Worker's code to your deployed Worker,
            so you don't have to copy/paste it manually after an update. Doesn't touch
            your existing secrets (MODE, message overrides, etc.) — confirm with
            "Refresh status" afterward the first time you use this.
          </p>
          <div class="status-row" v-if="codePushedAt">
            <span class="label">Code last pushed</span>
            <span class="value">{{ fmtAge(codePushedAt) }}</span>
          </div>
          <label class="field-checkbox">
            <input type="checkbox" v-model="form.autoPushCode" />
            <span>Automatically push new code when this plugin updates</span>
          </label>
          <div class="modal-actions modal-actions-left">
            <button class="btn btn-primary" :disabled="!configComplete || pushingCode" @click="pushWorkerCode">
              {{ pushingCode ? 'Pushing…' : 'Update Worker Code' }}
            </button>
          </div>
        </div>

        <div class="modal-actions">
          <button class="btn" @click="closeModals">Cancel</button>
          <button class="btn btn-primary" @click="saveSettings">Save</button>
        </div>
      </div>
    </div>

    <div v-if="showMessages" class="modal-backdrop" @click.self="closeModals" @keydown.esc="closeModals">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="messages-title">
        <h2 id="messages-title">Messages</h2>
        <p class="modal-intro">
          Leave a field blank to use the Worker's built-in default. These write to Worker
          secrets, so they're also editable straight from the Cloudflare dashboard
          (Worker → Settings → Variables and Secrets) — either place works.
        </p>

        <div class="msg-group">
          <h3>Under Maintenance</h3>
          <label class="field">
            <span>Title</span>
            <input v-model="messagesForm.maintTitle" type="text" :placeholder="defaults.maintTitle" />
          </label>
          <label class="field">
            <span>Body</span>
            <textarea v-model="messagesForm.maintBody" rows="2" :placeholder="defaults.maintBody"></textarea>
          </label>
        </div>

        <div class="msg-group">
          <h3>Restarting</h3>
          <label class="field">
            <span>Title</span>
            <input v-model="messagesForm.restartTitle" type="text" :placeholder="defaults.restartTitle" />
          </label>
          <label class="field">
            <span>Body</span>
            <textarea v-model="messagesForm.restartBody" rows="2" :placeholder="defaults.restartBody"></textarea>
          </label>
        </div>

        <div class="msg-group">
          <h3>Offline (down &gt; 15 min)</h3>
          <label class="field">
            <span>Title</span>
            <input v-model="messagesForm.offlineTitle" type="text" :placeholder="defaults.offlineTitle" />
          </label>
          <label class="field">
            <span>Body</span>
            <textarea v-model="messagesForm.offlineBody" rows="2" :placeholder="defaults.offlineBody"></textarea>
          </label>
        </div>

        <div class="msg-group">
          <h3>Footnote</h3>
          <label class="field">
            <span>Shown on every page above</span>
            <input v-model="messagesForm.footnote" type="text" placeholder="(none)" />
          </label>
        </div>

        <div class="modal-actions">
          <button class="btn" @click="closeModals">Cancel</button>
          <button class="btn btn-primary" :disabled="!configComplete || pushingMessages" @click="pushMessages">
            {{ pushingMessages ? 'Pushing…' : 'Push to Worker' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { WORKER_SOURCE, WORKER_COMPATIBILITY_DATE } from "./generated/worker-bundle.js";

// Cheap change-detection for the bundled Worker source, not a real
// checksum - just enough to tell "auto-push" whether this plugin build's
// code differs from what was last actually pushed, so it doesn't PUT the
// same code to the Worker on every single page load.
function hashSource(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (Math.imul(31, hash) + str.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
const WORKER_SOURCE_HASH = hashSource(WORKER_SOURCE);

const PLUGIN_NAME = "breaker-box";

const MODE_LABELS = {
  M: "Under Maintenance",
  R: "Restarting",
  off: "Normal",
};

// Field -> Worker secret name. Matches worker/src/index.js's
// DEFAULT_MESSAGES keys exactly, since these are pushed as secrets with
// these names.
const MESSAGE_SECRET_NAMES = {
  maintTitle: "MAINT_TITLE",
  maintBody: "MAINT_BODY",
  restartTitle: "RESTART_TITLE",
  restartBody: "RESTART_BODY",
  offlineTitle: "OFFLINE_TITLE",
  offlineBody: "OFFLINE_BODY",
  footnote: "FOOTNOTE",
};

// Mirrors the Worker's DEFAULT_MESSAGES, shown as field placeholders
// so the settings panel reflects what visitors actually see today.
const DEFAULT_MESSAGES = {
  maintTitle: "Under maintenance",
  maintBody: "This server is offline for scheduled maintenance. It'll be back online shortly.",
  restartTitle: "Restarting",
  restartBody: "This server is restarting for a moment. It'll be back online shortly.",
  offlineTitle: "Device is offline",
  offlineBody: "This server has been unreachable for a while. Please contact the owner.",
  footnote: "",
};

export default {
  name: "BreakerBoxPlugin",
  data() {
    return {
      apiBase: "/api/v1",
      authToken: null,
      showSettings: false,
      showMessages: false,
      formSnapshot: null,
      messagesFormSnapshot: null,
      error: null,
      successMessage: null,
      checking: false,
      busy: null, // 'M' | 'R' | 'off' | null
      pushingMessages: false,
      pushingCode: false,
      secretExists: null, // true | false | null (unknown)
      lastKnownState: { value: null, setAt: null, revertAt: null },
      messagesPushedAt: null,
      codePushedAt: null,
      revertMinutes: 0, // 0 = no timer
      defaults: DEFAULT_MESSAGES,
      form: {
        workerUrl: "",
        apiToken: "",
        accountId: "",
        scriptName: "",
        secretName: "MODE",
        containerName: "",
        autoPushCode: true,
        // Master switch for both the background container-watch service
        // and the auto-push-on-update behavior below. Off means: the
        // watcher (watcher.js, reading this same settings.json) goes
        // fully idle regardless of container selection, and this plugin
        // never auto-pushes code on mount - manual buttons (the M/R/off
        // row, Push to Worker, Update Worker Code) still work either way.
        autoFeaturesEnabled: true,
      },
      lastPushedWorkerHash: null,
      containerOptions: [],
      loadingContainers: false,
      containerOptionsError: null,
      messagesForm: {
        maintTitle: "",
        maintBody: "",
        restartTitle: "",
        restartBody: "",
        offlineTitle: "",
        offlineBody: "",
        footnote: "",
      },
    };
  },
  computed: {
    configComplete() {
      const f = this.form;
      return !!(f.workerUrl && f.apiToken && f.accountId && f.scriptName && f.secretName);
    },
  },
  watch: {
    "form.workerUrl"(newUrl) {
      // Only for the default *.workers.dev URL, where the first hostname
      // label really is the script name - a custom domain reveals nothing
      // about the underlying script, so don't guess there. Never overwrite
      // a name the user already entered.
      if (this.form.scriptName) return;
      const guess = this.guessScriptName(newUrl);
      if (guess) this.form.scriptName = guess;
    },
  },
  mounted() {
    this.authToken = this.findAuthToken();
    document.addEventListener("keydown", this.handleGlobalKeydown);
    this.loadSettings().then(() => {
      if (this.configComplete) this.checkSecretExists();
      // Auto-push: only when the global auto-features switch and the
      // auto-push toggle are both on, connection settings are filled in,
      // and this build's Worker source actually differs from what was
      // last pushed - otherwise every normal page load would re-PUT the
      // same code to Cloudflare for no reason.
      if (
        this.configComplete &&
        this.form.autoFeaturesEnabled &&
        this.form.autoPushCode &&
        this.lastPushedWorkerHash !== WORKER_SOURCE_HASH
      ) {
        this.pushWorkerCode();
      }
    });
  },
  beforeUnmount() {
    document.removeEventListener("keydown", this.handleGlobalKeydown);
  },
  methods: {
    modeLabel(v) {
      return MODE_LABELS[v] || v;
    },
    fmtAge(ts) {
      if (!ts) return "unknown time";
      const mins = Math.round((Date.now() - ts) / 60000);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
      const days = Math.round(hrs / 24);
      return `${days} day${days === 1 ? "" : "s"} ago`;
    },
    fmtRevertAt(ts) {
      if (!ts) return "—";
      const mins = Math.round((ts - Date.now()) / 60000);
      if (mins <= 0) return "any moment now";
      if (mins < 60) return `in ~${mins} min`;
      const hrs = Math.round(mins / 60);
      return `in ~${hrs} hr${hrs === 1 ? "" : "s"}`;
    },
    guessScriptName(url) {
      try {
        const host = new URL(url).hostname;
        const m = host.match(/^([a-z0-9-]+)\.[a-z0-9-]+\.workers\.dev$/i);
        return m ? m[1] : null;
      } catch (e) {
        return null;
      }
    },
    openSettings() {
      this.showMessages = false;
      this.formSnapshot = { ...this.form };
      this.showSettings = true;
      if (this.containerOptions.length === 0) this.loadContainerOptions();
    },
    openMessages() {
      this.showSettings = false;
      this.messagesFormSnapshot = { ...this.messagesForm };
      this.showMessages = true;
    },
    // Cancel, Escape, and clicking the backdrop all discard unsaved edits -
    // only Save/Push commit them. Without restoring the snapshot here,
    // "Cancel" would just skip the network write while leaving the edited
    // values sitting in the form, which looks like it saved when it didn't.
    closeModals() {
      if (this.showSettings && this.formSnapshot) this.form = this.formSnapshot;
      if (this.showMessages && this.messagesFormSnapshot) this.messagesForm = this.messagesFormSnapshot;
      this.formSnapshot = null;
      this.messagesFormSnapshot = null;
      this.showSettings = false;
      this.showMessages = false;
    },
    handleGlobalKeydown(e) {
      if (e.key === "Escape" && (this.showSettings || this.showMessages)) {
        this.closeModals();
      }
    },

    // --- MOS auth token, same scanning approach as smart-health-dashboard ---
    findAuthToken() {
      const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
      const scanStorage = (storage) => {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          const val = storage.getItem(key);
          if (!val) continue;
          if (jwtPattern.test(val)) return val;
          try {
            const parsed = JSON.parse(val);
            const candidates = [
              parsed?.token, parsed?.accessToken, parsed?.access_token,
              parsed?.jwt, parsed?.authToken, parsed?.user?.token, parsed?.state?.token,
            ];
            for (const c of candidates) {
              if (typeof c === "string" && jwtPattern.test(c)) return c;
            }
          } catch (e) {
            // Not JSON.
          }
        }
        return null;
      };
      return scanStorage(window.localStorage) || scanStorage(window.sessionStorage);
    },
    mosAuthHeaders() {
      const headers = { Accept: "application/json" };
      if (this.authToken) headers["Authorization"] = `Bearer ${this.authToken}`;
      return headers;
    },

    // --- Plugin settings: MOS server-side store, localStorage fallback ---
    async loadSettings() {
      try {
        const res = await fetch(`${this.apiBase}/mos/plugins/settings/${PLUGIN_NAME}`, {
          headers: this.mosAuthHeaders(),
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const settings = data?.settings || data || {};
        if (settings.form) this.form = { ...this.form, ...settings.form };
        if (settings.lastKnownState) this.lastKnownState = settings.lastKnownState;
        if (settings.messagesForm) this.messagesForm = { ...this.messagesForm, ...settings.messagesForm };
        if (settings.messagesPushedAt) this.messagesPushedAt = settings.messagesPushedAt;
        if (settings.codePushedAt) this.codePushedAt = settings.codePushedAt;
        if (settings.lastPushedWorkerHash) this.lastPushedWorkerHash = settings.lastPushedWorkerHash;
      } catch (e) {
        this.loadLocalSettingsFallback();
      }
    },
    async saveSettingsToServer() {
      try {
        const res = await fetch(`${this.apiBase}/mos/plugins/settings/${PLUGIN_NAME}`, {
          method: "POST",
          headers: { ...this.mosAuthHeaders(), "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            form: this.form,
            lastKnownState: this.lastKnownState,
            messagesForm: this.messagesForm,
            messagesPushedAt: this.messagesPushedAt,
            codePushedAt: this.codePushedAt,
            lastPushedWorkerHash: this.lastPushedWorkerHash,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (e) {
        this.saveLocalSettingsFallback();
      }
    },
    loadLocalSettingsFallback() {
      try {
        const saved = window.localStorage.getItem("breaker-box-settings");
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.form) this.form = { ...this.form, ...parsed.form };
          if (parsed.lastKnownState) this.lastKnownState = parsed.lastKnownState;
          if (parsed.messagesForm) this.messagesForm = { ...this.messagesForm, ...parsed.messagesForm };
          if (parsed.messagesPushedAt) this.messagesPushedAt = parsed.messagesPushedAt;
          if (parsed.codePushedAt) this.codePushedAt = parsed.codePushedAt;
          if (parsed.lastPushedWorkerHash) this.lastPushedWorkerHash = parsed.lastPushedWorkerHash;
        }
      } catch (e) {
        // No settings yet - fine, starts empty.
      }
    },
    saveLocalSettingsFallback() {
      try {
        window.localStorage.setItem(
          "breaker-box-settings",
          JSON.stringify({
            form: this.form,
            lastKnownState: this.lastKnownState,
            messagesForm: this.messagesForm,
            messagesPushedAt: this.messagesPushedAt,
            codePushedAt: this.codePushedAt,
            lastPushedWorkerHash: this.lastPushedWorkerHash,
          })
        );
      } catch (e) {
        // Storage unavailable - settings just won't persist.
      }
    },
    saveSettings() {
      this.formSnapshot = null;
      this.showSettings = false;
      this.error = null;
      this.saveSettingsToServer();
      if (this.configComplete) this.checkSecretExists();
    },

    // --- Cloudflare API, via the Worker's own built-in relay ---
    relayBase() {
      return this.form.workerUrl.replace(/\/$/, "") + "/__bbproxy";
    },
    scriptUrl() {
      return `${this.relayBase()}/client/v4/accounts/${this.form.accountId}/workers/scripts/${this.form.scriptName}`;
    },
    secretsUrl() {
      return `${this.scriptUrl()}/secrets`;
    },
    cfAuthHeaders() {
      return {
        Authorization: `Bearer ${this.form.apiToken}`,
        "Content-Type": "application/json",
      };
    },
    async checkSecretExists() {
      if (!this.configComplete) return;
      this.checking = true;
      this.error = null;
      try {
        const res = await fetch(this.secretsUrl(), { headers: this.cfAuthHeaders() });
        const data = await res.json();
        if (!res.ok || data.success === false) {
          throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
        }
        const names = (data.result || []).map((s) => s.name);
        this.secretExists = names.includes(this.form.secretName);
      } catch (e) {
        this.secretExists = null;
        this.error = `Couldn't check secret status: ${e.message}`;
      } finally {
        this.checking = false;
      }
    },
    revertSecretName() {
      return `${this.form.secretName}_REVERT_AT`;
    },
    // DELETE is idempotent from the user's perspective: Cloudflare returns
    // "Binding '<name>' not found" when the secret already doesn't exist,
    // which just means we're already in the state we wanted, not a failure.
    async deleteSecretIfPresent(name) {
      const res = await fetch(`${this.secretsUrl()}/${name}`, {
        method: "DELETE",
        headers: this.cfAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      const alreadyGone = !res.ok && /not found/i.test(data?.errors?.[0]?.message || "");
      if (!res.ok && !alreadyGone) {
        throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
      }
    },
    async putSecret(name, text) {
      const res = await fetch(this.secretsUrl(), {
        method: "PUT",
        headers: this.cfAuthHeaders(),
        body: JSON.stringify({ name, text, type: "secret_text" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
      }
    },
    async setMode(state) {
      if (!this.configComplete || this.busy) return;
      this.busy = state;
      this.error = null;
      this.successMessage = null;
      try {
        let revertAt = null;

        if (state === "off") {
          await this.deleteSecretIfPresent(this.form.secretName);
          await this.deleteSecretIfPresent(this.revertSecretName());
        } else {
          await this.putSecret(this.form.secretName, state);
          if (this.revertMinutes > 0) {
            revertAt = Date.now() + this.revertMinutes * 60000;
            await this.putSecret(this.revertSecretName(), String(revertAt));
          } else {
            await this.deleteSecretIfPresent(this.revertSecretName());
          }
        }

        this.lastKnownState = { value: state, setAt: Date.now(), revertAt };
        this.saveSettingsToServer();
        this.successMessage = `${this.modeLabel(state)} applied.`;
        await this.checkSecretExists();
      } catch (e) {
        this.error = `Failed to set mode: ${e.message}`;
      } finally {
        this.busy = null;
      }
    },
    // Blank field -> delete the secret, so the Worker falls back to its
    // built-in default instead of pushing an empty string.
    async pushMessages() {
      if (!this.configComplete || this.pushingMessages) return;
      this.pushingMessages = true;
      this.error = null;
      this.successMessage = null;
      try {
        for (const [field, secretName] of Object.entries(MESSAGE_SECRET_NAMES)) {
          const value = (this.messagesForm[field] || "").trim();
          if (value) {
            await this.putSecret(secretName, value);
          } else {
            await this.deleteSecretIfPresent(secretName);
          }
        }
        this.messagesPushedAt = Date.now();
        this.saveSettingsToServer();
        this.successMessage = "Messages pushed to Worker.";
        this.messagesFormSnapshot = null;
        this.showMessages = false;
      } catch (e) {
        this.error = `Failed to push messages: ${e.message}`;
      } finally {
        this.pushingMessages = false;
      }
    },
    // The global switch controls the watcher (via this settings.json
    // field, which it reads directly - see watcher/watcher.js) and,
    // separately, the Worker's own auto-detect fallback (via an actual
    // Worker secret, since the Worker only ever sees its own env). Both
    // need updating together whenever this switch changes.
    async applyAutoFeaturesToggle() {
      if (this.configComplete) {
        try {
          if (this.form.autoFeaturesEnabled) {
            await this.deleteSecretIfPresent("AUTO_FEATURES_ENABLED");
          } else {
            await this.putSecret("AUTO_FEATURES_ENABLED", "0");
          }
        } catch (e) {
          this.error = `Failed to update Worker: ${e.message}`;
        }
      }
      this.saveSettingsToServer();
    },
    async fetchWorkerSettings() {
      const res = await fetch(`${this.scriptUrl()}/settings`, {
        headers: { Authorization: `Bearer ${this.form.apiToken}` },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
      }
      return data.result || {};
    },
    // Reads back the Worker's current bindings and re-submits the
    // non-secret ones (vars, KV, etc.) alongside the new code. Secret
    // bindings are deliberately left out: Cloudflare's settings endpoint
    // reports that a secret exists (name/type) but never returns its
    // actual value, so echoing one back fails validation ("missing text
    // property"). Omitting a binding from this request instead relies on
    // Cloudflare preserving whatever's already bound under that name -
    // which is the only option here, since there's no value to send even
    // if we wanted to.
    async pushWorkerCode() {
      if (!this.configComplete || this.pushingCode) return;
      this.pushingCode = true;
      this.error = null;
      this.successMessage = null;
      try {
        const settings = await this.fetchWorkerSettings();
        const metadata = {
          main_module: "index.js",
          compatibility_date: settings.compatibility_date || WORKER_COMPATIBILITY_DATE,
        };
        if (settings.compatibility_flags) metadata.compatibility_flags = settings.compatibility_flags;
        const nonSecretBindings = (settings.bindings || []).filter((b) => b.type !== "secret_text");
        if (nonSecretBindings.length > 0) metadata.bindings = nonSecretBindings;

        const body = new FormData();
        body.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
        body.append("index.js", new Blob([WORKER_SOURCE], { type: "application/javascript+module" }), "index.js");

        const res = await fetch(this.scriptUrl(), {
          method: "PUT",
          headers: { Authorization: `Bearer ${this.form.apiToken}` },
          body,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data.success === false) {
          throw new Error(data?.errors?.[0]?.message || `HTTP ${res.status}`);
        }

        this.codePushedAt = Date.now();
        this.lastPushedWorkerHash = WORKER_SOURCE_HASH;
        this.saveSettingsToServer();
        this.successMessage = "Worker code updated. Use Refresh status to confirm secrets are intact.";
        await this.checkSecretExists();
      } catch (e) {
        this.error = `Failed to update Worker code: ${e.message}`;
      } finally {
        this.pushingCode = false;
      }
    },

    // --- Container watch: dropdown only, via MOS's Docker proxy ---
    // (Cloudflare Workers run at the edge and can't reach a LAN Docker
    // socket directly - see worker/README.md. The actual watching happens
    // in the background service, watcher/watcher.js - this is just for
    // populating the dropdown below.)
    async loadContainerOptions() {
      this.loadingContainers = true;
      this.containerOptionsError = null;
      try {
        const res = await fetch(`${this.apiBase}/docker/containers/json?all=true`, {
          headers: this.mosAuthHeaders(),
          credentials: "include",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const containers = await res.json();
        this.containerOptions = (containers || [])
          .map((c) => (c.Names && c.Names[0] ? c.Names[0].replace(/^\//, "") : null))
          .filter(Boolean)
          .sort();
      } catch (e) {
        this.containerOptionsError = `Couldn't load containers: ${e.message}`;
      } finally {
        this.loadingContainers = false;
      }
    },
  },
};
</script>

<style scoped>
.breaker-box {
  font-family: system-ui, sans-serif;
  padding: 1rem;
  max-width: 640px;
  color: #e8e8ec;
}
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.toolbar h1 {
  font-size: 1.25rem;
  margin: 0;
  color: #f2f2f4;
}
.toolbar-right {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}
.banner {
  padding: 0.6rem 0.9rem;
  border-radius: 6px;
  margin-bottom: 0.75rem;
  font-size: 0.9rem;
}
.banner-warn {
  background: #78350f;
  color: #fde68a;
}
.banner-ok {
  background: #14532d;
  color: #bbf7d0;
}
.status-card {
  border: 1px solid #2a2a30;
  background: #17171b;
  border-radius: 8px;
  padding: 0.9rem 1rem;
  margin-bottom: 1rem;
}
.status-row {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.25rem 0;
}
.status-row .label {
  color: #9a9aa2;
}
.status-row .value {
  color: #e8e8ec;
  text-align: right;
}
.badge {
  padding: 0.1rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}
.badge-set { background: #4c1d1d; color: #fca5a5; }
.badge-clear { background: #14532d; color: #86efac; }
.badge-unknown { background: #374151; color: #d1d5db; }

.timer-field {
  display: block;
  margin-bottom: 1rem;
}
.timer-field span {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.3rem;
  color: #cbd5e1;
}
.timer-field select {
  width: 100%;
  min-height: 44px;
  padding: 0.4rem 0.5rem;
  border-radius: 5px;
  border: 1px solid #3a3a42;
  background: #0f0f13;
  color: #e8e8ec;
  box-sizing: border-box;
  font-size: 0.9rem;
}
.timer-field small {
  display: block;
  color: #7d7d85;
  font-size: 0.75rem;
  margin-top: 0.3rem;
  line-height: 1.4;
}

.button-row {
  display: flex;
  gap: 0.6rem;
  flex-wrap: wrap;
}
.btn {
  min-height: 44px;
  padding: 0.6rem 1.1rem;
  border-radius: 6px;
  border: 1px solid #3a3a42;
  background: #1f1f24;
  color: #e8e8ec;
  cursor: pointer;
  font-size: 0.9rem;
  transition: border-color 0.15s ease;
}
.btn:not(:disabled):hover {
  border-color: #55555f;
}
.btn:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.btn:disabled {
  opacity: 0.45;
  cursor: default;
}
.btn-icon {
  min-width: 44px;
  padding: 0.5rem 0.7rem;
  font-size: 1rem;
}
.btn-maint {
  background: #78350f;
  border-color: #d97706;
  color: #fde68a;
}
.btn-restart {
  background: #1e3a8a;
  border-color: #2563eb;
  color: #bfdbfe;
}
.btn-off {
  background: #14532d;
  border-color: #16a34a;
  color: #bbf7d0;
}
.btn-primary {
  background: #2563eb;
  color: #fff;
  border-color: #2563eb;
}

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
  padding: 1rem;
}
.modal {
  background: #18181d;
  color: #e8e8ec;
  border: 1px solid #2a2a30;
  padding: 1.25rem 1.5rem;
  border-radius: 10px;
  width: 100%;
  max-width: 460px;
  max-height: calc(100vh - 2rem);
  overflow-y: auto;
}
.modal h2 {
  margin-top: 0;
  font-size: 1.1rem;
  color: #f2f2f4;
}
.modal-intro {
  font-size: 0.82rem;
  color: #9a9aa2;
  line-height: 1.5;
  margin: -0.25rem 0 1rem;
}
.modal-intro a {
  color: #60a5fa;
}
.modal-intro a:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}
.msg-group {
  border-top: 1px solid #26262c;
  padding-top: 0.9rem;
  margin-top: 0.9rem;
}
.msg-group:first-of-type {
  border-top: none;
  padding-top: 0;
  margin-top: 0;
}
.msg-group h3 {
  font-size: 0.85rem;
  font-weight: 600;
  color: #cbd5e1;
  margin: 0 0 0.6rem;
}
.field {
  display: block;
  margin-bottom: 0.75rem;
}
.field span {
  display: block;
  font-size: 0.85rem;
  margin-bottom: 0.2rem;
  color: #cbd5e1;
}
.field input,
.field textarea,
.field select {
  width: 100%;
  min-height: 44px;
  padding: 0.4rem 0.5rem;
  border-radius: 5px;
  border: 1px solid #3a3a42;
  background: #0f0f13;
  color: #e8e8ec;
  box-sizing: border-box;
  font-family: inherit;
  font-size: 0.9rem;
}
.field textarea {
  resize: vertical;
}
.field input:focus-visible,
.field textarea:focus-visible,
.field select:focus-visible,
.timer-field select:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}
.field input::placeholder,
.field textarea::placeholder {
  color: #6b6b73;
}
.field small {
  color: #7d7d85;
  font-size: 0.75rem;
}
.field-checkbox {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0.5rem 0;
  padding: 0.4rem 0;
  min-height: 44px;
  box-sizing: border-box;
  font-size: 0.85rem;
  color: #cbd5e1;
  cursor: pointer;
}
.field-checkbox input {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
.field-checkbox input:focus-visible {
  outline: 2px solid #60a5fa;
  outline-offset: 1px;
}
.global-toggle {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  border: 1px solid #2a2a30;
  background: #17171b;
  border-radius: 8px;
  padding: 0.7rem 0.9rem;
  margin-bottom: 0.75rem;
  min-height: 44px;
  box-sizing: border-box;
  cursor: pointer;
}
.global-toggle-text {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  font-size: 0.9rem;
  color: #e8e8ec;
  font-weight: 600;
}
.global-toggle-text small {
  font-size: 0.75rem;
  font-weight: 400;
  color: #9a9aa2;
  line-height: 1.4;
}
.switch {
  position: relative;
  display: inline-flex;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
}
.switch input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  opacity: 0;
  cursor: pointer;
}
.switch-track {
  position: absolute;
  inset: 0;
  background: #71717a;
  border-radius: 999px;
  transition: background-color 0.15s ease;
}
.switch-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 18px;
  height: 18px;
  background: #ffffff;
  border-radius: 50%;
  transition: transform 0.15s ease;
}
.switch input:checked ~ .switch-track {
  background: #16a34a;
}
.switch input:checked ~ .switch-track .switch-thumb {
  transform: translateX(18px);
}
.switch input:focus-visible ~ .switch-track {
  outline: 2px solid #60a5fa;
  outline-offset: 2px;
}
.field-with-button {
  display: flex;
  gap: 0.5rem;
  align-items: stretch;
}
.field-with-button select {
  flex: 1;
  min-width: 0;
}
.watch-error {
  color: #fca5a5;
}
.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
  margin-top: 1rem;
}
.modal-actions-left {
  justify-content: flex-start;
}
</style>
