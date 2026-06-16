import { Router, Response } from 'express';
import { db } from '../db';
import { authMiddleware, adminMiddleware } from '../middleware/auth';
import { AuthRequest, BusRoute, Station, RouteStationWithStation, Announcement, AnnouncementWithRoutes } from '../types';

const router = Router();

router.use(authMiddleware);
router.use(adminMiddleware);

// GET /api/admin/routes
router.get('/routes', (_req: AuthRequest, res: Response): void => {
  try {
    const routes = db.prepare('SELECT * FROM bus_routes ORDER BY route_number ASC').all() as BusRoute[];
    res.json(routes);
  } catch (err) {
    res.status(500).json({ error: '获取线路列表失败' });
  }
});

// POST /api/admin/routes
router.post('/routes', (req: AuthRequest, res: Response): void => {
  try {
    const { name, route_number, start_station, end_station, first_bus_time, last_bus_time, price, description } = req.body;
    if (!name || !route_number || !start_station || !end_station || !first_bus_time || !last_bus_time) {
      res.status(400).json({ error: '请填写完整线路信息' });
      return;
    }

    const existing = db.prepare('SELECT id FROM bus_routes WHERE route_number = ?').get(route_number);
    if (existing) {
      res.status(409).json({ error: '线路编号已存在' });
      return;
    }

    const result = db.prepare(`
      INSERT INTO bus_routes (name, route_number, start_station, end_station, first_bus_time, last_bus_time, price, description)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, route_number, start_station, end_station, first_bus_time, last_bus_time, price || 2.0, description || '');

    const newRoute = db.prepare('SELECT * FROM bus_routes WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(newRoute);
  } catch (err) {
    res.status(500).json({ error: '创建线路失败' });
  }
});

// PUT /api/admin/routes/:id
router.put('/routes/:id', (req: AuthRequest, res: Response): void => {
  try {
    const routeId = parseInt(req.params.id);
    if (isNaN(routeId)) {
      res.status(400).json({ error: '无效的线路ID' });
      return;
    }

    const existing = db.prepare('SELECT id FROM bus_routes WHERE id = ?').get(routeId);
    if (!existing) {
      res.status(404).json({ error: '线路不存在' });
      return;
    }

    const { name, route_number, start_station, end_station, first_bus_time, last_bus_time, price, description } = req.body;

    const dupCheck = db.prepare('SELECT id FROM bus_routes WHERE route_number = ? AND id != ?').get(route_number, routeId);
    if (dupCheck) {
      res.status(409).json({ error: '线路编号已被其他线路使用' });
      return;
    }

    db.prepare(`
      UPDATE bus_routes SET name = ?, route_number = ?, start_station = ?, end_station = ?,
      first_bus_time = ?, last_bus_time = ?, price = ?, description = ?
      WHERE id = ?
    `).run(name, route_number, start_station, end_station, first_bus_time, last_bus_time, price, description, routeId);

    const updated = db.prepare('SELECT * FROM bus_routes WHERE id = ?').get(routeId);
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: '更新线路失败' });
  }
});

// DELETE /api/admin/routes/:id
router.delete('/routes/:id', (req: AuthRequest, res: Response): void => {
  try {
    const routeId = parseInt(req.params.id);
    if (isNaN(routeId)) {
      res.status(400).json({ error: '无效的线路ID' });
      return;
    }

    const result = db.prepare('DELETE FROM bus_routes WHERE id = ?').run(routeId);
    if (result.changes === 0) {
      res.status(404).json({ error: '线路不存在' });
      return;
    }
    res.json({ message: '线路已删除' });
  } catch (err) {
    res.status(500).json({ error: '删除线路失败' });
  }
});

// GET /api/admin/routes/:id/stations
router.get('/routes/:id/stations', (req: AuthRequest, res: Response): void => {
  try {
    const routeId = parseInt(req.params.id);
    if (isNaN(routeId)) {
      res.status(400).json({ error: '无效的线路ID' });
      return;
    }

    const stations = db.prepare(`
      SELECT rs.*, s.name AS station_name, s.latitude, s.longitude
      FROM route_stations rs
      JOIN stations s ON rs.station_id = s.id
      WHERE rs.route_id = ?
      ORDER BY rs.stop_order ASC
    `).all(routeId) as RouteStationWithStation[];

    res.json(stations);
  } catch (err) {
    res.status(500).json({ error: '获取站点列表失败' });
  }
});

// POST /api/admin/routes/:id/stations
router.post('/routes/:id/stations', (req: AuthRequest, res: Response): void => {
  try {
    const routeId = parseInt(req.params.id);
    if (isNaN(routeId)) {
      res.status(400).json({ error: '无效的线路ID' });
      return;
    }

    const { name, latitude, longitude, distance_km } = req.body;
    if (!name) {
      res.status(400).json({ error: '请填写站点名称' });
      return;
    }

    const existing = db.prepare('SELECT id FROM bus_routes WHERE id = ?').get(routeId);
    if (!existing) {
      res.status(404).json({ error: '线路不存在' });
      return;
    }

    const maxOrder = db.prepare(
      'SELECT MAX(stop_order) as max_order FROM route_stations WHERE route_id = ?'
    ).get(routeId) as { max_order: number | null };
    const newOrder = (maxOrder.max_order || 0) + 1;

    const stationResult = db.prepare('INSERT INTO stations (name, latitude, longitude) VALUES (?, ?, ?)').run(
      name, latitude || 0, longitude || 0
    );
    const stationId = stationResult.lastInsertRowid as number;

    db.prepare('INSERT INTO route_stations (route_id, station_id, stop_order, distance_km) VALUES (?, ?, ?, ?)').run(
      routeId, stationId, newOrder, distance_km || 0
    );

    const newStation = db.prepare(`
      SELECT rs.*, s.name AS station_name, s.latitude, s.longitude
      FROM route_stations rs
      JOIN stations s ON rs.station_id = s.id
      WHERE rs.id = ?
    `).get(stationResult.lastInsertRowid);

    res.status(201).json(newStation);
  } catch (err) {
    res.status(500).json({ error: '添加站点失败' });
  }
});

// DELETE /api/admin/stations/:id
router.delete('/stations/:id', (req: AuthRequest, res: Response): void => {
  try {
    const routeStationId = parseInt(req.params.id);
    if (isNaN(routeStationId)) {
      res.status(400).json({ error: '无效的站点ID' });
      return;
    }

    const routeStation = db.prepare('SELECT * FROM route_stations WHERE id = ?').get(routeStationId) as RouteStationWithStation | undefined;
    if (!routeStation) {
      res.status(404).json({ error: '站点不存在' });
      return;
    }

    // Delete the route_station entry
    db.prepare('DELETE FROM route_stations WHERE id = ?').run(routeStationId);

    // Reorder remaining stops
    const remaining = db.prepare(
      'SELECT id FROM route_stations WHERE route_id = ? ORDER BY stop_order ASC'
    ).all(routeStation.route_id) as { id: number }[];
    const updateOrder = db.prepare('UPDATE route_stations SET stop_order = ? WHERE id = ?');
    remaining.forEach((r, i) => updateOrder.run(i + 1, r.id));

    // Delete station if not referenced elsewhere
    const refCount = db.prepare(
      'SELECT COUNT(*) as count FROM route_stations WHERE station_id = ?'
    ).get(routeStation.station_id) as { count: number };
    if (refCount.count === 0) {
      db.prepare('DELETE FROM stations WHERE id = ?').run(routeStation.station_id);
    }

    res.json({ message: '站点已删除' });
  } catch (err) {
    res.status(500).json({ error: '删除站点失败' });
  }
});

// GET /api/admin/announcements
router.get('/announcements', (_req: AuthRequest, res: Response): void => {
  try {
    const announcements = db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all() as Announcement[];
    const result: AnnouncementWithRoutes[] = announcements.map(a => {
      const routes = db.prepare('SELECT route_id FROM announcement_routes WHERE announcement_id = ?').all(a.id) as { route_id: number }[];
      return {
        ...a,
        route_ids: routes.map(r => r.route_id),
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: '获取公告列表失败' });
  }
});

// POST /api/admin/announcements
router.post('/announcements', (req: AuthRequest, res: Response): void => {
  try {
    const { title, content, route_ids } = req.body;
    if (!title || !content) {
      res.status(400).json({ error: '请填写标题和正文' });
      return;
    }
    if (!Array.isArray(route_ids) || route_ids.length === 0) {
      res.status(400).json({ error: '请选择至少一条关联线路' });
      return;
    }

    const insertAnnouncement = db.prepare('INSERT INTO announcements (title, content) VALUES (?, ?)');
    const insertRoute = db.prepare('INSERT INTO announcement_routes (announcement_id, route_id) VALUES (?, ?)');

    const result = db.transaction(() => {
      const annResult = insertAnnouncement.run(title, content);
      const annId = annResult.lastInsertRowid as number;
      for (const rid of route_ids) {
        insertRoute.run(annId, rid);
      }
      return annId;
    })();

    const newAnnouncement = db.prepare('SELECT * FROM announcements WHERE id = ?').get(result) as Announcement;
    const routes = db.prepare('SELECT route_id FROM announcement_routes WHERE announcement_id = ?').all(result) as { route_id: number }[];
    res.status(201).json({
      ...newAnnouncement,
      route_ids: routes.map(r => r.route_id),
    });
  } catch (err) {
    res.status(500).json({ error: '发布公告失败' });
  }
});

// DELETE /api/admin/announcements/:id
router.delete('/announcements/:id', (req: AuthRequest, res: Response): void => {
  try {
    const annId = parseInt(req.params.id);
    if (isNaN(annId)) {
      res.status(400).json({ error: '无效的公告ID' });
      return;
    }

    const existing = db.prepare('SELECT id FROM announcements WHERE id = ?').get(annId);
    if (!existing) {
      res.status(404).json({ error: '公告不存在' });
      return;
    }

    db.prepare('DELETE FROM announcements WHERE id = ?').run(annId);
    res.json({ message: '公告已删除' });
  } catch (err) {
    res.status(500).json({ error: '删除公告失败' });
  }
});

export default router;
