<script lang="ts">
  import { invalidateAll } from "$app/navigation";
  import Button from "$lib/components/ui/Button.svelte";
  import Banner from "$lib/components/ui/Banner.svelte";

  // --- download backup -------------------------------------------------
  let busyBackup = $state(false);
  let backupNote = $state<string | null>(null);

  async function downloadBackup(): Promise<void> {
    if (busyBackup) return;
    busyBackup = true;
    backupNote = null;
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      // Prefer the server's suggested name; fall back to a stamped default.
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = /filename="?([^";]+)"?/.exec(cd);
      a.href = url;
      a.download =
        m?.[1] ?? `mynyl-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      document.body.append(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      backupNote = `Packed ${(blob.size / 1024 / 1024).toFixed(1)}MB — the download should have started.`;
    } catch (e) {
      backupNote = e instanceof Error ? e.message : "Backup failed.";
    } finally {
      busyBackup = false;
    }
  }

  // --- restore from file ------------------------------------------------
  let busyRestore = $state(false);
  let restoreNote = $state<string | null>(null);
  let restoreError = $state<string | null>(null);
  // DOM ref for the hidden file input (bind:this requires a plain let in runes mode).
  let fileInput: HTMLInputElement | undefined = undefined;

  function pickFile(): void {
    fileInput?.click();
  }

  async function onFileChosen(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // allow re-picking the same file later
    if (!file) return;

    restoreNote = null;
    restoreError = null;
    const ok = confirm(
      `Restore from "${file.name}"?\n\nThis REPLACES your current collection. The current DB and media are preserved in data/.pre-restore until the next restore.`,
    );
    if (!ok) return;

    busyRestore = true;
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      const res = await fetch("/api/restore", { method: "POST", body: form });
      const j = (await res.json().catch(() => null)) as {
        ok?: boolean;
        record_count?: number;
        media_count?: number;
        message?: string;
      } | null;
      if (!res.ok || !j?.ok)
        throw new Error(j?.message ?? `HTTP ${res.status}`);
      restoreNote = `Restored: ${j.record_count} records, ${j.media_count} media files. The previous generation is kept in .pre-restore.`;
      await invalidateAll(); // the whole page now reflects the restored collection
    } catch (err) {
      restoreError = err instanceof Error ? err.message : "Restore failed.";
    } finally {
      busyRestore = false;
    }
  }
</script>

<!-- Backup & restore (F8): the local-first safety net. Quiet footer section —
     download is a routine utility, restore is deliberate (confirm dialog). -->
<section class="border-b border-hair py-10">
  <div class="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
    <div class="max-w-md">
      <h2
        class="text-[10.5px] font-semibold uppercase tracking-[.22em] text-faint"
      >
        Backup
      </h2>
      <p
        class="mt-2.5 font-display text-[14.5px] italic leading-snug text-muted"
      >
        The whole collection — database and every cover & photo — as a single
        zip. Restore it to any machine, or back it up before you fiddle with the
        volume.
      </p>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <Button
        variant="primary"
        size="sm"
        type="button"
        disabled={busyBackup}
        onclick={() => void downloadBackup()}
      >
        {busyBackup ? "Packing…" : "Download backup"}
      </Button>
      <Button
        variant="danger"
        size="sm"
        type="button"
        disabled={busyRestore}
        onclick={pickFile}
      >
        {busyRestore ? "Restoring…" : "Restore from file"}
      </Button>
      <input
        type="file"
        accept=".zip,application/zip"
        class="hidden"
        bind:this={fileInput}
        onchange={(e) => void onFileChosen(e)}
      />
    </div>
  </div>

  {#if backupNote}
    <p class="mt-4 text-[12.5px] italic text-muted">{backupNote}</p>
  {/if}
  {#if restoreNote}
    <div class="mt-4">
      <Banner variant="success">{restoreNote}</Banner>
    </div>
  {/if}
  {#if restoreError}
    <div class="mt-4">
      <Banner variant="error"
        >{restoreError} — your collection was left untouched (a restore aborts before
        it touches anything it can't verify).</Banner
      >
    </div>
  {/if}
</section>
