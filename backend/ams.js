import { verifyAccess, accessToken } from './access.js';
const ADMIN_EMAIL = 'th2006464@gmail.com';
const adminUser = async (request, env) => {
  const user = await verifyAccess(accessToken(request), env);
  return user?.email?.trim().toLowerCase() === ADMIN_EMAIL ? user : null;
};
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, X-Import-Key"
};

export default {
  async fetch(request, env) {

    const url = new URL(request.url);
    // Browser data requires this service's own verified Access identity.
    // Agent /report and the original import key validation remain unchanged.
    if (['/devices', '/assets'].includes(url.pathname) && request.method !== 'OPTIONS') {
      if (!await verifyAccess(accessToken(request), env)) {
        return new Response('Unauthorized', { status: 401, headers: {'Cache-Control':'no-store'} });
      }
    }

    // =====================================
    // CORS
    // =====================================
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders
      });
    }


    // =====================================
    // POST /report
    // Agent 自动上报
    //
    // !!! 生产冻结模块 !!!
    // 保持现有 Agent 上传逻辑不变
    // =====================================
    if (url.pathname === "/report") {

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: corsHeaders
        });
      }

      if (request.headers.get("X-Api-Key") !== env.API_KEY) {
        return new Response("Unauthorized", {
          status: 401,
          headers: corsHeaders
        });
      }

      try {

        const data = await request.json();

        await env.DB.prepare(`
          INSERT INTO devices
          (
            serial_number,
            computer_name,
            windows_user,
            outlook_account,
            manufacturer,
            model,
            os_name,
            forticlient_user,
            forticlient_last_seen,
            c_drive_total_gb,
            c_drive_free_gb,
            report_time,
            script_version
          )
          VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

          ON CONFLICT(serial_number)
          DO UPDATE SET

            computer_name = excluded.computer_name,

            windows_user = excluded.windows_user,

            outlook_account = excluded.outlook_account,

            manufacturer = excluded.manufacturer,

            model = excluded.model,

            os_name = excluded.os_name,

            forticlient_user =
              CASE
                WHEN excluded.forticlient_user IS NOT NULL
                     AND excluded.forticlient_user != ''
                THEN excluded.forticlient_user
                ELSE devices.forticlient_user
              END,

            forticlient_last_seen =
              CASE
                WHEN excluded.forticlient_last_seen IS NOT NULL
                     AND excluded.forticlient_last_seen != ''
                THEN excluded.forticlient_last_seen
                ELSE devices.forticlient_last_seen
              END,

            c_drive_total_gb =
              CASE
                WHEN excluded.c_drive_total_gb IS NOT NULL
                THEN excluded.c_drive_total_gb
                ELSE devices.c_drive_total_gb
              END,

            c_drive_free_gb =
              CASE
                WHEN excluded.c_drive_free_gb IS NOT NULL
                THEN excluded.c_drive_free_gb
                ELSE devices.c_drive_free_gb
              END,

            report_time = excluded.report_time,

            script_version = excluded.script_version
        `)
        .bind(
          data.SerialNumber,
          data.ComputerName,
          data.WindowsUser,
          data.OutlookAccount,
          data.Manufacturer,
          data.Model,
          data.OSName,
          data.FortiClientUser || null,
          data.FortiClientLastSeen || null,
          data.CDriveTotalGB ?? null,
          data.CDriveFreeGB ?? null,
          data.ReportTime,
          data.ScriptVersion
        )
        .run();

        return new Response(
          JSON.stringify({
            success: true
          }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );

      }
      catch (error) {

        return new Response(
          JSON.stringify({
            success: false,
            error: error.message
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
    }


    // =====================================
    // POST /import-assets
    // 导入向日葵 / 资产 CSV
    //
    // 使用独立 IMPORT_KEY
    // 不使用 Agent 的 API_KEY
    // =====================================
    if (url.pathname === "/import-assets") {

      if (request.method !== "POST") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: corsHeaders
        });
      }

      // 管理员通过已验证的 Cloudflare Access JWT 授权，不接受浏览器密码或邮箱声明。
      if (!await adminUser(request, env)) {
        return Response.json({success:false,error:"Administrator access required"}, {status:403,headers:corsHeaders});
      }

      try {

        const body = await request.json();

        if (!body.devices || !Array.isArray(body.devices)) {
          return new Response(
            JSON.stringify({
              success: false,
              error: "Invalid devices data"
            }),
            {
              status: 400,
              headers: {
                ...corsHeaders,
                "Content-Type": "application/json"
              }
            }
          );
        }

        let imported = 0;
        let skipped = 0;
        for (const device of body.devices) {

          const serialNumber =
            String(device.serial_number || "")
              .trim()
              .toUpperCase();

          // 未初始化设备无 SN：跳过，不写入数据库。
          if (!serialNumber) {
            skipped++;
            continue;
          }

          await env.DB.prepare(`
            INSERT INTO asset_inventory
            (
              serial_number,
              device_name,
              asset_note,
              status,
              asset_group,
              sunlogin_code,
              sunlogin_version,
              deployment_source,
              system_version,
              mac_address,
              internal_ip,
              last_login_ip,
              last_online_time,
              computer_name,
              processor,
              memory,
              import_time
            )

            VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

            ON CONFLICT(serial_number)
            DO UPDATE SET

              device_name = excluded.device_name,

              asset_note = excluded.asset_note,

              status = excluded.status,

              asset_group = excluded.asset_group,

              sunlogin_code = excluded.sunlogin_code,

              sunlogin_version = excluded.sunlogin_version,

              deployment_source = excluded.deployment_source,

              system_version = excluded.system_version,

              mac_address = excluded.mac_address,

              internal_ip = excluded.internal_ip,

              last_login_ip = excluded.last_login_ip,

              last_online_time = excluded.last_online_time,

              computer_name = excluded.computer_name,

              processor = excluded.processor,

              memory = excluded.memory,

              import_time = excluded.import_time
          `)
          .bind(
            serialNumber,
            device.device_name || null,
            device.asset_note || null,
            device.status || null,
            device.asset_group || null,
            device.sunlogin_code || null,
            device.sunlogin_version || null,
            device.deployment_source || null,
            device.system_version || null,
            device.mac_address || null,
            device.internal_ip || null,
            device.last_login_ip || null,
            device.last_online_time || null,
            device.computer_name || null,
            device.processor || null,
            device.memory || null,
            new Date().toISOString()
          )
          .run();

          imported++;
        }

        return new Response(
          JSON.stringify({
            success: true,
            received: body.devices.length,
            imported: imported,
            skipped: skipped
          }),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );

      }
      catch (error) {

        return new Response(
          JSON.stringify({
            success: false,
            error: error.message
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
    }


    // 管理员精确删除。只按 SN，不按计算机名；含资产前缀的旧 SN 必须唯一匹配。
    if (url.pathname === "/delete-device") {
      if (request.method !== "POST") return new Response("Method Not Allowed",{status:405,headers:corsHeaders});
      const admin = await adminUser(request,env);
      if (!admin) return Response.json({error:"Administrator access required"},{status:403,headers:corsHeaders});
      try {
        const body = await request.json();
        const sn = String(body.serial_number || "").trim().toUpperCase();
        const scope = body.scope;
        if (!sn || sn.length > 256 || !["agent","asset","both"].includes(scope))
          return Response.json({error:"Invalid serial number or deletion scope"},{status:400,headers:corsHeaders});
        const candidates = [];
        for (const table of (scope === "both" ? ["devices","asset_inventory"] : [scope === "agent" ? "devices" : "asset_inventory"])) {
          const rows = await env.DB.prepare(`SELECT serial_number FROM ${table} WHERE UPPER(TRIM(serial_number)) = ?`).bind(sn).all();
          let matches = rows.results || [];
          // 向日葵历史备注可能是 3101466-SN；仅唯一命中才允许删除。
          if (table === "asset_inventory" && matches.length === 0) {
            const old = await env.DB.prepare(`SELECT serial_number FROM asset_inventory WHERE UPPER(TRIM(serial_number)) LIKE ?`).bind("%-" + sn).all();
            matches = (old.results || []).filter(x => String(x.serial_number).trim().toUpperCase().endsWith("-" + sn));
          }
          if (matches.length > 1) return Response.json({error:"Multiple matching records; deletion cancelled"},{status:409,headers:corsHeaders});
          if (matches.length === 0) return Response.json({error:`No matching ${table} record; nothing deleted`},{status:404,headers:corsHeaders});
          candidates.push({table,serial:matches[0].serial_number});
        }
        // 审计与删除在同一个 D1 batch 事务中执行，失败则不留下部分删除。
        await env.DB.prepare(`CREATE TABLE IF NOT EXISTS asset_admin_audit (
          id TEXT PRIMARY KEY, action TEXT NOT NULL, actor_email TEXT NOT NULL,
          serial_number TEXT NOT NULL, scope TEXT NOT NULL, details TEXT, created_at TEXT NOT NULL
        )`).run();
        const statements = candidates.map(x => env.DB.prepare(`DELETE FROM ${x.table} WHERE serial_number = ?`).bind(x.serial));
        statements.push(env.DB.prepare(`INSERT INTO asset_admin_audit
          (id,action,actor_email,serial_number,scope,details,created_at)
          VALUES (?,?,?,?,?,?,?)`).bind(crypto.randomUUID(),"delete",admin.email,sn,scope,JSON.stringify(candidates),new Date().toISOString()));
        await env.DB.batch(statements);
        return Response.json({success:true,deleted:candidates},{headers:corsHeaders});
      } catch(error) {
        return Response.json({error:"Deletion failed",detail:String(error?.message || error)},{status:500,headers:corsHeaders});
      }
    }

    // =====================================
    // GET /devices
    //
    // Agent devices
    //       +
    // asset_inventory
    //
    // 返回两个数据源的 SN 并集
    // =====================================
    if (url.pathname === "/devices") {

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: corsHeaders
        });
      }

      try {

        const result = await env.DB.prepare(`

          /*
           * 第一部分：
           * 所有 Agent 已经上报的设备
           *
           * 如果资产表也有对应 SN，则同时带出资产信息。
           */

          SELECT

            d.serial_number AS serial_number,

            d.computer_name AS computer_name,
            d.windows_user AS windows_user,
            d.outlook_account AS outlook_account,

            d.manufacturer AS manufacturer,
            d.model AS model,
            d.os_name AS os_name,

            d.forticlient_user AS forticlient_user,
            d.forticlient_last_seen AS forticlient_last_seen,

            d.c_drive_total_gb AS c_drive_total_gb,
            d.c_drive_free_gb AS c_drive_free_gb,

            d.report_time AS report_time,
            d.script_version AS script_version,


            /* ==============================
               Asset / 向日葵字段
               ============================== */

            a.device_name AS asset_device_name,
            a.asset_note AS asset_note,

            a.status AS sun_status,
            a.asset_group AS sun_group,

            a.sunlogin_code AS sunlogin_code,
            a.sunlogin_version AS sunlogin_version,

            a.deployment_source AS deployment_source,

            a.system_version AS asset_system_version,

            a.mac_address AS mac_address,
            a.internal_ip AS internal_ip,
            a.last_login_ip AS last_login_ip,
            a.last_online_time AS last_online_time,

            a.computer_name AS asset_computer_name,

            a.processor AS processor,
            a.memory AS memory,

            a.import_time AS asset_import_time,


            /* ==============================
               纳管状态
               ============================== */

            1 AS has_agent,

            CASE
              WHEN a.serial_number IS NOT NULL THEN 1
              ELSE 0
            END AS has_asset,

            CASE
              WHEN a.serial_number IS NOT NULL
              THEN 'managed'
              ELSE 'asset_missing'
            END AS management_status


          FROM devices d

          LEFT JOIN asset_inventory a

            ON UPPER(TRIM(d.serial_number))
             =
               UPPER(TRIM(a.serial_number))


          UNION ALL


          /*
           * 第二部分：
           * 资产表存在，但 Agent 从未上报的设备
           */

          SELECT

            a.serial_number AS serial_number,


            /*
             * Agent 没有 computer_name，
             * 主列表仍然优先显示资产表中的 computer_name，
             * 没有时再使用 device_name。
             */

            COALESCE(
              NULLIF(a.computer_name, ''),
              a.device_name
            ) AS computer_name,


            NULL AS windows_user,
            NULL AS outlook_account,

            NULL AS manufacturer,
            NULL AS model,

            /*
             * Agent 没有系统名称时，
             * 使用资产表里的 system_version。
             */
            a.system_version AS os_name,

            NULL AS forticlient_user,
            NULL AS forticlient_last_seen,

            NULL AS c_drive_total_gb,
            NULL AS c_drive_free_gb,

            NULL AS report_time,
            NULL AS script_version,


            /* ==============================
               Asset / 向日葵字段
               ============================== */

            a.device_name AS asset_device_name,
            a.asset_note AS asset_note,

            a.status AS sun_status,
            a.asset_group AS sun_group,

            a.sunlogin_code AS sunlogin_code,
            a.sunlogin_version AS sunlogin_version,

            a.deployment_source AS deployment_source,

            a.system_version AS asset_system_version,

            a.mac_address AS mac_address,
            a.internal_ip AS internal_ip,
            a.last_login_ip AS last_login_ip,
            a.last_online_time AS last_online_time,

            a.computer_name AS asset_computer_name,

            a.processor AS processor,
            a.memory AS memory,

            a.import_time AS asset_import_time,


            /* ==============================
               纳管状态
               ============================== */

            0 AS has_agent,
            1 AS has_asset,

            'agent_missing' AS management_status


          FROM asset_inventory a

          LEFT JOIN devices d

            ON UPPER(TRIM(d.serial_number))
             =
               UPPER(TRIM(a.serial_number))

          WHERE d.serial_number IS NULL


          /*
           * Agent 有 report_time 的按上报时间排序。
           * 纯资产记录没有 report_time，
           * 排在后面。
           */

          ORDER BY report_time DESC

        `).all();


        return new Response(
          JSON.stringify(result.results),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );

      }
      catch (error) {

        return new Response(
          JSON.stringify({
            success: false,
            error: error.message
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
    }


    // =====================================
    // GET /assets
    // 临时调试接口
    //
    // 暂时保留
    // 用于确认 asset_inventory 数据
    // =====================================
    if (url.pathname === "/assets") {

      if (request.method !== "GET") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: corsHeaders
        });
      }

      try {

        const result = await env.DB.prepare(`
          SELECT
            serial_number,
            device_name,
            asset_note,
            status,
            asset_group,
            sunlogin_code,
            sunlogin_version,
            deployment_source,
            system_version,
            mac_address,
            internal_ip,
            last_login_ip,
            last_online_time,
            computer_name,
            processor,
            memory,
            import_time
          FROM asset_inventory
          ORDER BY import_time DESC
        `).all();

        return new Response(
          JSON.stringify(result.results),
          {
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );

      }
      catch (error) {

        return new Response(
          JSON.stringify({
            success: false,
            error: error.message
          }),
          {
            status: 500,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json"
            }
          }
        );
      }
    }


    // =====================================
    // 首页
    // =====================================
    if (url.pathname === "/") {

      return new Response(
        JSON.stringify({
          service: "GARCHINA Asset Center API",
          version: "1.5.0",
          status: "running"
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json"
          }
        }
      );
    }


    // =====================================
    // 404
    // =====================================
    return new Response("Not Found", {
      status: 404,
      headers: corsHeaders
    });
  }
};