import Link from "next/link";
import type { Route } from "next";

import { createContactSavedViewAction, deleteContactSavedViewAction } from "@/app/contacts/actions";
import { createDealSavedViewAction, deleteDealSavedViewAction } from "@/app/deals/actions";
import { createLeadSavedViewAction, deleteLeadSavedViewAction } from "@/app/leads/actions";
import { createOrganizationSavedViewAction, deleteOrganizationSavedViewAction } from "@/app/organizations/actions";
import {
  serializeListViewState,
  serializedListViewStateToSearchParams,
  type ListViewState
} from "@/lib/list-page-query";
import type { ContactSavedView, DealSavedView, LeadSavedView, OrganizationSavedView } from "@/lib/services/crm";

type DealSavedViewsPanelProps = {
  listState: ListViewState;
  savedViews: DealSavedView[];
};
type LeadSavedViewsPanelProps = {
  listState: ListViewState;
  savedViews: LeadSavedView[];
};
type ContactSavedViewsPanelProps = {
  listState: ListViewState;
  savedViews: ContactSavedView[];
};
type OrganizationSavedViewsPanelProps = {
  listState: ListViewState;
  savedViews: OrganizationSavedView[];
};
type SavedViewsPanelProps = {
  listState: ListViewState;
  savedViews: Array<{ id: string; name: string; href: string }>;
  title: string;
  emptyCopy: string;
  inputId: string;
  createAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
};

export function DealSavedViewsPanel({ listState, savedViews }: DealSavedViewsPanelProps) {
  return (
    <SavedViewsPanel
      listState={listState}
      savedViews={savedViews}
      title="Saved deal views"
      emptyCopy="No deal views saved yet."
      inputId="deal-saved-view-name"
      createAction={createDealSavedViewAction}
      deleteAction={deleteDealSavedViewAction}
    />
  );
}

export function LeadSavedViewsPanel({ listState, savedViews }: LeadSavedViewsPanelProps) {
  return (
    <SavedViewsPanel
      listState={listState}
      savedViews={savedViews}
      title="Saved lead views"
      emptyCopy="No lead views saved yet."
      inputId="lead-saved-view-name"
      createAction={createLeadSavedViewAction}
      deleteAction={deleteLeadSavedViewAction}
    />
  );
}

export function ContactSavedViewsPanel({ listState, savedViews }: ContactSavedViewsPanelProps) {
  return (
    <SavedViewsPanel
      listState={listState}
      savedViews={savedViews}
      title="Saved contact views"
      emptyCopy="No contact views saved yet."
      inputId="contact-saved-view-name"
      createAction={createContactSavedViewAction}
      deleteAction={deleteContactSavedViewAction}
    />
  );
}

export function OrganizationSavedViewsPanel({ listState, savedViews }: OrganizationSavedViewsPanelProps) {
  return (
    <SavedViewsPanel
      listState={listState}
      savedViews={savedViews}
      title="Saved organization views"
      emptyCopy="No organization views saved yet."
      inputId="organization-saved-view-name"
      createAction={createOrganizationSavedViewAction}
      deleteAction={deleteOrganizationSavedViewAction}
    />
  );
}

function SavedViewsPanel({
  listState,
  savedViews,
  title,
  emptyCopy,
  inputId,
  createAction,
  deleteAction
}: SavedViewsPanelProps) {
  const currentStateParams = serializedListViewStateToSearchParams(serializeListViewState(listState));

  return (
    <section className="panel saved-views-panel">
      <div className="saved-views-header">
        <h2 className="panel-title">{title}</h2>
        <form action={createAction} className="saved-view-form">
          {Array.from(currentStateParams.entries()).map(([key, value]) => (
            <input key={key} name={key} type="hidden" value={value} />
          ))}
          <label className="sr-only" htmlFor={inputId}>
            Saved view name
          </label>
          <input id={inputId} name="name" placeholder="View name" required />
          <button className="button-primary button-compact" type="submit">
            Save view
          </button>
        </form>
      </div>
      {savedViews.length > 0 ? (
        <ul className="saved-view-list">
          {savedViews.map((view) => (
            <li className="saved-view-item" key={view.id}>
              <Link className="inline-link" href={view.href as Route}>
                {view.name}
              </Link>
              <form action={deleteAction}>
                <input name="savedViewId" type="hidden" value={view.id} />
                <button className="button-secondary button-compact" type="submit">
                  Delete view
                </button>
              </form>
            </li>
          ))}
        </ul>
      ) : (
        <p className="empty-copy">{emptyCopy}</p>
      )}
    </section>
  );
}
