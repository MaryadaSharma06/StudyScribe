const crypto = require("crypto");

/*
  Keeps recently used documents in the server's memory so the tutor does not
  have to fetch them from the database on every question.
  The database is the real copy; anything missing here is loaded again from there.
*/
const MAX_DOCUMENTS = 50;
const documents = new Map();

// Keeps the pieces of a document and returns its id. `id` and `userId` come from the saved study set.
function saveDocument(pieces, { id = crypto.randomUUID(), userId = null } = {}) {
  documents.delete(id);
  // A Map remembers insertion order, so the first key is the oldest document
  if (documents.size >= MAX_DOCUMENTS) {
    documents.delete(documents.keys().next().value);
  }

  documents.set(id, { pieces, userId });
  return id;
}

function getDocument(id) {
  return documents.get(id) || null;
}

function forgetDocument(id) {
  documents.delete(id);
}

module.exports = { saveDocument, getDocument, forgetDocument, MAX_DOCUMENTS };
