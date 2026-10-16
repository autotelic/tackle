exports.up = function (knex) {
  return knex.schema.createTable('payroll_crew', function (table) {
    table.uuid('shakti_user_id')
    table.uuid('project_id').notNullable()
    table.uuid('id').primary()
  })
}
