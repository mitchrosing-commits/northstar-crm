type ListResourceLabelConfig = {
  createNoun: string;
  plural: string;
  searchPlaceholder: string;
  singular: string;
};

export type ListResourceKey =
  | "activities"
  | "contacts"
  | "deals"
  | "leads"
  | "organizations"
  | "products"
  | "quotes";

const listResourceLabels = {
  activities: {
    createNoun: "an activity",
    plural: "activities",
    searchPlaceholder: "Activity title, description, or linked record",
    singular: "Activity"
  },
  contacts: {
    createNoun: "a contact",
    plural: "contacts",
    searchPlaceholder: "Name, email, phone, or organization",
    singular: "Contact"
  },
  deals: {
    createNoun: "a deal",
    plural: "deals",
    searchPlaceholder: "Deal title, contact, or organization",
    singular: "Deal"
  },
  leads: {
    createNoun: "a lead",
    plural: "leads",
    searchPlaceholder: "Lead title, source, contact, or organization",
    singular: "Lead"
  },
  organizations: {
    createNoun: "an organization",
    plural: "organizations",
    searchPlaceholder: "Organization name or domain",
    singular: "Organization"
  },
  products: {
    createNoun: "a product",
    plural: "products",
    searchPlaceholder: "Product name or description",
    singular: "Product"
  },
  quotes: {
    createNoun: "a quote",
    plural: "quotes",
    searchPlaceholder: "Quote number, deal, contact, or organization",
    singular: "Quote"
  }
} satisfies Record<ListResourceKey, ListResourceLabelConfig>;

export function listResourcePluralLabel(resource: string) {
  return listResourceConfig(resource)?.plural ?? "records";
}

export function listResourceSingularLabel(resource: string) {
  return listResourceConfig(resource)?.singular ?? "Record";
}

export function listResourceSearchPlaceholder(resource: string) {
  return listResourceConfig(resource)?.searchPlaceholder ?? "Search records";
}

export function listResultSingularLabel(resultLabel: string) {
  const singular = listResourceConfig(resultLabel)?.singular;
  return singular ? singular.toLowerCase() : resultLabel.replace(/s$/, "");
}

export function listResourceCreateActionLabel(resource: string, createLabel: string) {
  const createNoun = listResourceConfig(resource)?.createNoun;
  return createNoun ? `${createLabel}: create ${createNoun}` : createLabel;
}

function listResourceConfig(resource: string) {
  return listResourceLabels[resource as ListResourceKey];
}
