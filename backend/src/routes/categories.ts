import { Router } from 'express';
import { query } from '../db/pool';
import { me } from '../middleware/auth';
import { handler } from '../utils/http';

export const categoriesRouter = Router();

/** Catálogo de categorías y subcategorías (los administradores también ven las inactivas). */
categoriesRouter.get(
  '/',
  handler(async (req, res) => {
    const includeInactive = me(req).role === 'admin';
    const rows = await query(
      `SELECT id, name, parent_id, active FROM categories
        WHERE ($1 OR active) ORDER BY COALESCE(parent_id, id), parent_id NULLS FIRST, name`,
      [includeInactive],
    );
    res.json({ categories: rows });
  }),
);
