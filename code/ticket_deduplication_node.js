// Deduplication & Ticket Management Node (JavaScript for n8n Code Node)
// Searches existing open tickets in Google Sheets before creating or updating.

const inputItem = $input.first().json;
const orderId = inputItem.classification?.order_id || inputItem.order?.order_id || null;
const emailId = inputItem.email?.id || "";
const existingTickets = inputItem.existing_tickets || []; // Passed from Google Sheets Get Rows

let isUpdate = false;
let targetTicketId = null;
let updatedNotes = "";
let emailIdsList = [emailId];

if (orderId && existingTickets.length > 0) {
  // Look for open ticket for same order_id
  const openTicket = existingTickets.find(t => 
    t.order_id === orderId && (t.status || "").toLowerCase() !== "closed"
  );

  if (openTicket) {
    isUpdate = true;
    targetTicketId = openTicket.ticket_id;
    const prevEmails = openTicket.email_ids ? openTicket.email_ids.split(",").map(e => e.trim()) : [];
    if (!prevEmails.includes(emailId)) {
      prevEmails.push(emailId);
    }
    emailIdsList = prevEmails;
    updatedNotes = `${openTicket.notes || ""}; Updated via ${emailId} on 2026-11-20: ${inputItem.classification?.summary || ""}`.trim();
  }
}

if (!isUpdate) {
  // Generate a new ticket ID e.g. TKT-1001
  const count = existingTickets.length + 1;
  targetTicketId = `TKT-${String(1000 + count).padStart(4, "0")}`;
  updatedNotes = `Initial ticket created from ${emailId}: ${inputItem.classification?.summary || ""}`;
}

return {
  json: {
    ...inputItem,
    ticket_decision: {
      is_update: isUpdate,
      ticket_id: targetTicketId,
      email_ids: emailIdsList.join(", "),
      status: "Open",
      priority: inputItem.ticket_priority || "Normal",
      notes: updatedNotes,
      summary: inputItem.classification?.summary || "Support request"
    }
  }
};
