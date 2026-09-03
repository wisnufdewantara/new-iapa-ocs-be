// Enam role sistem, sama persis dengan model Users.Role di CMS-IAPA-BE (Java)
// supaya data role user hasil copy dari database lama tetap valid.
export enum Role {
  Admin = 'Admin',
  Peserta = 'Peserta',
  Reviewer = 'Reviewer',
  Admin_Keuangan = 'Admin_Keuangan',
  Manager = 'Manager',
  Moderator = 'Moderator',
}
