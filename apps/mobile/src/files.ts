import { Directory, File, Paths } from "expo-file-system";

function ensureCaseDirectory(caseId: string): Directory {
  const directory = new Directory(Paths.document, "medmesh", "cases", caseId);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

export function storeLocalFile(
  caseId: string,
  sourceUri: string,
  fileName: string,
): string {
  const directory = ensureCaseDirectory(caseId);
  const destination = new File(directory, fileName);
  const source = new File(sourceUri);
  source.copy(destination);
  return destination.uri;
}
