import{db}from"../../storage/db.js";import{createAdminUsersRouter as createRouter}from"./route.js";import{AdminUsersService}from"./service.js";import{SqliteAdminUsersRepository}from"./sqliteRepository.js";
export function createAdminUsersRouter(){return createRouter(new AdminUsersService(new SqliteAdminUsersRepository(db)));}
