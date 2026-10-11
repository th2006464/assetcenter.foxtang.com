import { verifyAccess, accessToken } from './access.js';
import {importAssets} from './import-assets.js';
import {manageRecords} from './admin.js';
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Api-Key, X-Import-Key"
};

export default {
  async fetch(request, env) {

    const url = new URL(request.url);
    if(['/admin/records','/admin/records/detail'].includes(url.pathname))return manageRecords(request,env);
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
            forticlient_version,
            c_drive_total_gb,
            c_drive_free_gb,
            report_time,
            script_version
          )
          VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

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

            forticlient_version =
              CASE
                WHEN excluded.forticlient_version IS NOT NULL
                     AND excluded.forticlient_version != ''
                THEN excluded.forticlient_version
                ELSE devices.forticlient_version
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
        `).bind(
          data.SerialNumber,
          data.ComputerName,
          data.WindowsUser,
          data.OutlookAccount,
          data.Manufacturer,
          data.Model,
          data.OSName,
          data.FortiClientUser || null,
          data.FortiClientLastSeen || null,
          data.FortiClientVersion || null,
          data.CDriveTotalGB ?? null,
          data.CDriveFreeGB ?? null,
          data.ReportTime,
          data.ScriptVersion
        ).run();
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
      } catch (error) {
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
      if(request.method!=="POST")return new Response("Method Not Allowed",{status:405});
      const token=accessToken(request);
      const user=await verifyAccess(token,env);
      if(token&&!user)return Response.json({error:'Unauthorized'},{status:401});
      if(user&&user.role!=='admin')return Response.json({error:'需要管理员权限'},{status:403});
      if(!user&&(!env.IMPORT_KEY||request.headers.get('X-Import-Key')!==env.IMPORT_KEY))return Response.json({error:'Unauthorized'},{status:401});
      return importAssets(request,env,user?.email||'machine-import');
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
            d.serial_number AS agent_serial_number,
            d.computer_name AS agent_original_name,
            a.serial_number AS asset_serial_number,
            a.computer_name AS asset_original_name,

            d.computer_name AS computer_name,
            d.windows_user AS windows_user,
            d.outlook_account AS outlook_account,

            d.manufacturer AS manufacturer,
            d.model AS model,
            d.os_name AS os_name,

            d.forticlient_user AS forticlient_user,
            d.forticlient_last_seen AS forticlient_last_seen,
            d.forticlient_version AS forticlient_version,

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
            NULL AS agent_serial_number,
            NULL AS agent_original_name,
            a.serial_number AS asset_serial_number,
            a.computer_name AS asset_original_name,


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
            NULL AS forticlient_version,

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
          JSON.stringify(result.results.map(row=>{
            const {agent_serial_number,agent_original_name,asset_serial_number,asset_original_name,...data}=row;
            const record_refs=[];
            if(agent_serial_number!=null)record_refs.push({source:'agent',serial_number:agent_serial_number,computer_name:agent_original_name});
            if(asset_serial_number!=null)record_refs.push({source:'asset',serial_number:asset_serial_number,computer_name:asset_original_name});
            return {...data,record_refs};
          })),
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