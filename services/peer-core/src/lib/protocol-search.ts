import {
  type ProtocolCitation,
  type ProtocolDocument,
  type StructuredIntake,
} from "@medmesh/shared";
import { protocolDocuments } from "@medmesh/protocol-pack";

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

export function searchProtocolDocuments(
  query: string,
  topK = 3,
): ProtocolCitation[] {
  const queryTokens = new Set(tokenize(query));

  return protocolDocuments
    .map((document) => {
      const tagHits = document.tags.filter((tag) => queryTokens.has(tag)).length;
      const contentTokens = tokenize(`${document.title} ${document.content}`);
      const overlap = contentTokens.filter((token) => queryTokens.has(token)).length;
      const score = overlap + tagHits * 2;

      return {
        documentId: document.id,
        title: document.title,
        section: document.section,
        snippet: document.content.slice(0, 180),
        score,
      } satisfies ProtocolCitation;
    })
    .filter((citation) => (citation.score ?? 0) > 0)
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, topK);
}

export function buildProtocolQuery(
  intake: StructuredIntake,
  transcript: string,
  ocrText: string[],
): string {
  return [
    intake.chiefComplaint,
    intake.redFlags,
    intake.urgencyLevel,
    intake.mentalHealthContext,
    transcript,
    ...ocrText,
  ]
    .filter(Boolean)
    .join(" ");
}

export function expandCitations(
  citations: ProtocolCitation[],
): ProtocolDocument[] {
  return citations
    .map((citation) =>
      protocolDocuments.find((document) => document.id === citation.documentId),
    )
    .filter((document): document is ProtocolDocument => Boolean(document));
}
