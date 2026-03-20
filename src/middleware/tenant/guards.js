const requireTenantAuth = require("./requireTenantAuth");

module.exports.adminOnly = requireTenantAuth("admin");
module.exports.studentOnly = requireTenantAuth("student");
module.exports.lecturerOnly = requireTenantAuth("lecturer");
module.exports.staffOnly = requireTenantAuth("staff");
module.exports.financeOnly = requireTenantAuth("finance");
module.exports.librarianOnly = requireTenantAuth("librarian");
module.exports.hostelOnly = requireTenantAuth("hostel");
