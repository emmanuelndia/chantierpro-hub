'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authFetch } from '@/lib/auth/client-session';
import type { DocumentAttachmentItem, DocumentAttachmentListResponse } from '@/types/documents';

type DocumentAttachmentsPanelProps = Readonly<{
  title?: string;
  description?: string;
  context: {
    projectId?: string;
    siteId?: string;
    reportId?: string;
  };
  canUpload?: boolean;
  compact?: boolean;
}>;

const ACCEPTED_DOCUMENTS = '.pdf,.xlsx,.xls,.docx,.png,.jpg,.jpeg';

export function DocumentAttachmentsPanel({
  title = 'Pièces jointes',
  description = 'Documents, PV et livrables associés.',
  context,
  canUpload = false,
  compact = false,
}: DocumentAttachmentsPanelProps) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const queryKey = ['documents', context.projectId ?? '', context.siteId ?? '', context.reportId ?? ''];
  const documentsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const response = await authFetch(`/api/documents?${buildContextParams(context)}`);
      if (!response.ok) {
        throw new Error(`Documents request failed with status ${response.status}`);
      }
      return (await response.json()) as DocumentAttachmentListResponse;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      appendContext(formData, context);
      const response = await authFetch('/api/documents', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { message?: string } | null;
        throw new Error(payload?.message ?? "L'upload du document a échoué.");
      }
    },
    onSuccess: () => {
      setErrorMessage(null);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
      void queryClient.invalidateQueries({ queryKey });
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "L'upload du document a échoué.");
    },
  });

  const items = documentsQuery.data?.items ?? [];

  return (
    <section className={compact ? 'space-y-3' : 'rounded-[2rem] border border-slate-200 bg-white p-6 shadow-panel'}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className={compact ? 'text-sm font-black uppercase tracking-[0.16em] text-slate-500' : 'text-xl font-semibold text-slate-950'}>
            {title}
          </h2>
          {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
        </div>
        {canUpload ? (
          <label className="inline-flex min-h-10 cursor-pointer items-center justify-center rounded-full border border-orange-200 bg-orange-50 px-4 text-sm font-bold text-orange-700 transition hover:bg-orange-100">
            Ajouter un fichier
            <input
              ref={inputRef}
              accept={ACCEPTED_DOCUMENTS}
              className="sr-only"
              disabled={uploadMutation.isPending}
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                if (file) {
                  uploadMutation.mutate(file);
                }
              }}
              type="file"
            />
          </label>
        ) : null}
      </div>

      {uploadMutation.isPending ? <p className="mt-3 text-sm font-semibold text-orange-700">Upload en cours...</p> : null}
      {errorMessage ? <p className="mt-3 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{errorMessage}</p> : null}
      {documentsQuery.isLoading ? <p className="mt-4 text-sm text-slate-500">Chargement des documents...</p> : null}
      {documentsQuery.isError ? (
        <p className="mt-4 rounded-2xl border border-orange-200 bg-orange-50 p-3 text-sm font-semibold text-orange-700">
          Impossible de charger les pièces jointes.
        </p>
      ) : null}
      {!documentsQuery.isLoading && !documentsQuery.isError && items.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
          Aucun document ajouté.
        </p>
      ) : null}
      {items.length > 0 ? (
        <div className="mt-4 space-y-2">
          {items.map((item) => (
            <DocumentRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function DocumentRow({ item }: Readonly<{ item: DocumentAttachmentItem }>) {
  return (
    <a
      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm transition hover:border-orange-200 hover:bg-orange-50/40"
      href={item.downloadUrl}
      rel="noreferrer"
      target="_blank"
    >
      <span className="min-w-0">
        <span className="block truncate font-bold text-slate-900">{item.filename}</span>
        <span className="mt-1 block text-xs text-slate-500">
          {formatFileSize(item.fileSize)} - {item.uploadedBy.firstName} {item.uploadedBy.lastName} - {formatDate(item.createdAt)}
        </span>
      </span>
      <span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-black uppercase text-slate-500">
        {item.extension}
      </span>
    </a>
  );
}

function buildContextParams(context: DocumentAttachmentsPanelProps['context']) {
  const params = new URLSearchParams();
  if (context.projectId) params.set('projectId', context.projectId);
  if (context.siteId) params.set('siteId', context.siteId);
  if (context.reportId) params.set('reportId', context.reportId);
  return params.toString();
}

function appendContext(formData: FormData, context: DocumentAttachmentsPanelProps['context']) {
  if (context.projectId) formData.append('projectId', context.projectId);
  if (context.siteId) formData.append('siteId', context.siteId);
  if (context.reportId) formData.append('reportId', context.reportId);
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} Ko`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}
