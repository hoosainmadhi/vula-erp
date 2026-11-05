import { useState } from 'react';
import { Blocks, CheckCircle2, Lock, Power } from 'lucide-react';
import { api, errorMessage } from '../api';
import { useModules } from '../modules';
import { btnPrimary, btnSecondary, Card, ErrorBox, PageHeader, Spinner } from '../components/ui';
import type { Module } from '../types';

const CATEGORY_ORDER = ['Core', 'Trading', 'Finance', 'People', 'Operations'];

function orderCategories(modules: Module[]): string[] {
  const seen = [...new Set(modules.map((module) => module.category))];
  return seen.sort((a, b) => {
    const ai = CATEGORY_ORDER.indexOf(a);
    const bi = CATEGORY_ORDER.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
}

export default function PluginsPage() {
  const { modules, loading, error: loadError, reload } = useModules();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (module: Module) => {
    if (
      module.enabled &&
      !window.confirm(
        `Disable ${module.name}? Its screens will be hidden and its API will return 403 until re-enabled.`,
      )
    ) {
      return;
    }

    setBusy(module.key);
    setError(null);
    setNotice(null);
    try {
      await api.post(`/modules/${module.key}/${module.enabled ? 'disable' : 'enable'}`);
      reload();
      setNotice(`${module.name} ${module.enabled ? 'disabled' : 'enabled'}.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  if (loading && modules.length === 0) return <Spinner label="Loading modules…" />;

  const enabledCount = modules.filter((module) => module.enabled).length;
  const categories = orderCategories(modules);

  return (
    <div>
      <PageHeader
        title="Plugins"
        subtitle="Installable modules, modelled on AureusERP. Core modules are always on."
        actions={
          <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600">
            <CheckCircle2 className="size-4 text-emerald-600" />
            <span className="font-semibold text-slate-900">{enabledCount}</span>
            <span>of {modules.length} enabled</span>
          </div>
        }
      />

      {loadError ? <ErrorBox message={loadError} /> : null}
      {error ? <ErrorBox message={error} /> : null}
      {notice ? (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      ) : null}

      <div className="space-y-6">
        {categories.map((category) => (
          <section key={category}>
            <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-widest text-slate-400">
              {category}
            </h2>
            <div className="grid gap-3 md:grid-cols-2">
              {modules
                .filter((module) => module.category === category)
                .map((module) => (
                  <Card key={module.key} className="flex items-start gap-3 p-4">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${
                        module.enabled
                          ? 'bg-emerald-50 text-emerald-700'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      <Blocks className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-bold text-slate-900">{module.name}</h3>
                        {module.isCore ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                            <Lock className="size-3" /> Core
                          </span>
                        ) : module.enabled ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                            Enabled
                          </span>
                        ) : (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                            Disabled
                          </span>
                        )}
                        <code className="text-[11px] text-slate-400">{module.key}</code>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-slate-500">
                        {module.description}
                      </p>
                      <div className="mt-3">
                        {module.isCore ? (
                          <span className="text-xs font-medium text-slate-400">
                            Required by the system — cannot be disabled.
                          </span>
                        ) : (
                          <button
                            type="button"
                            className={module.enabled ? btnSecondary : btnPrimary}
                            disabled={busy === module.key}
                            onClick={() => void toggle(module)}
                          >
                            <Power className="size-4" />
                            {busy === module.key
                              ? 'Working…'
                              : module.enabled
                                ? 'Disable'
                                : 'Enable'}
                          </button>
                        )}
                      </div>
                    </div>
                  </Card>
                ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
