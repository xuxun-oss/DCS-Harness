window.__ModuleLoader__.load({ id: "dsh-dcs-cloud", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";

var React = require("react");
var h = React.createElement;

function injectCss() {
  if (document.getElementById("dsh-dcs-cloud-css")) return;
  var style = document.createElement("style");
  style.id = "dsh-dcs-cloud-css";
  style.textContent =
    ".dcstask{padding:16px 20px;max-width:960px;margin:0 auto;font-size:14px;line-height:1.6;color:inherit}" +
    ".dcstask h2{margin:0 0 4px;font-size:15px;font-weight:600}" +
    ".dcstask h3{margin:20px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.5px;opacity:.7}" +
    ".dcstask .dcs-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:4px}" +
    ".dcstask .dcs-title{font-size:18px;font-weight:700}" +
    ".dcstask .dcs-obj{opacity:.75;margin-bottom:6px}" +
    ".dcstask .dcs-tasks{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 4px}" +
    ".dcstask .dcs-tchip{padding:5px 12px;border-radius:999px;border:1px solid rgba(128,128,128,.4);cursor:pointer;background:transparent;color:inherit;font-size:12px}" +
    ".dcstask .dcs-tchip.on{background:#0f62fe;border-color:#0f62fe;color:#fff}" +
    ".dcstask .dcs-card{border:1px solid rgba(128,128,128,.25);border-radius:10px;padding:12px 14px;margin-bottom:10px}" +
    ".dcstask .dcs-src{display:flex;gap:8px;align-items:baseline;padding:4px 0;border-bottom:1px dashed rgba(128,128,128,.2)}" +
    ".dcstask .dcs-src .n{font-weight:600;min-width:150px}" +
    ".dcstask .dcs-src .p{opacity:.7;font-family:monospace;font-size:12px;word-break:break-all}" +
    ".dcstask .dcs-step{border-left:3px solid rgba(128,128,128,.4);padding:8px 12px;margin:8px 0;border-radius:0 8px 8px 0;background:rgba(128,128,128,.05)}" +
    ".dcstask .dcs-step.done{border-color:#22a06b;background:rgba(34,160,107,.08)}" +
    ".dcstask .dcs-step.running{border-color:#0f62fe;background:rgba(15,98,254,.08)}" +
    ".dcstask .dcs-step.failed{border-color:#e5484d;background:rgba(229,72,77,.08)}" +
    ".dcstask .dcs-step.blocked{border-color:#f5a524;background:rgba(245,165,36,.08)}" +
    ".dcstask .dcs-step .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}" +
    ".dcstask .dcs-step .row.dcs-step-head{cursor:pointer;user-select:none}" +
    ".dcstask .dcs-step .row.dcs-step-head:hover{opacity:.85}" +
    ".dcstask .dcs-step .t{font-weight:600}" +
    ".dcstask .dcs-chevron{opacity:.55;font-size:12px;width:14px;display:inline-block;transition:transform .15s}" +
    ".dcstask .dcs-chevron.open{transform:rotate(90deg)}" +
    ".dcstask .dcs-badge{font-size:11px;padding:1px 8px;border-radius:999px;color:#fff}" +
    ".dcstask .dcs-badge.pending{background:#8a8f98}" +
    ".dcstask .dcs-badge.running{background:#0f62fe}" +
    ".dcstask .dcs-badge.done{background:#22a06b}" +
    ".dcstask .dcs-badge.failed{background:#e5484d}" +
    ".dcstask .dcs-badge.blocked{background:#f5a524}" +
    ".dcstask .dcs-detail{font-size:12.5px;opacity:.78;margin:4px 0}" +
    ".dcstask .dcs-deps{font-size:12px;opacity:.65;margin-top:4px}" +
    ".dcstask .dcs-deps b{font-weight:600}" +
    ".dcstask .dcs-bar{height:5px;border-radius:3px;background:rgba(128,128,128,.2);margin-top:6px;overflow:hidden}" +
    ".dcstask .dcs-bar .fill{height:100%;background:#0f62fe;transition:width .4s}" +
    ".dcstask .dcs-bar .fill.done{background:#22a06b}" +
    ".dcstask .dcs-bar .fill.failed{background:#e5484d}" +
    ".dcstask .dcs-empty{border:1px dashed rgba(128,128,128,.4);border-radius:10px;padding:40px 20px;text-align:center;opacity:.7}" +
    ".dcstask .dcs-refresh{padding:5px 12px;border-radius:6px;border:1px solid rgba(128,128,128,.4);background:transparent;color:inherit;cursor:pointer;font-size:12px}" +
    ".dcstask .dcs-delivs{margin:8px 0 2px;padding:8px 10px;background:rgba(128,128,128,.06);border-radius:8px}" +
    ".dcstask .dcs-delivs .dh{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.4px;opacity:.65;margin:2px 0 4px}" +
    ".dcstask .dcs-deliv{display:flex;gap:8px;align-items:baseline;padding:3px 0;flex-wrap:wrap}" +
    ".dcstask .dcs-deliv .db{font-size:10px;padding:0 6px;border-radius:4px;color:#fff;flex:none}" +
    ".dcstask .dcs-deliv .db.dataset{background:#7c4dff}" +
    ".dcstask .dcs-deliv .db.result{background:#22a06b}" +
    ".dcstask .dcs-deliv .db.chart{background:#0f62fe}" +
    ".dcstask .dcs-deliv .db.report{background:#e5484d}" +
    ".dcstask .dcs-deliv .db.file{background:#8a8f98}" +
    ".dcstask .dcs-deliv .dn{font-weight:600;font-size:12.5px}" +
    ".dcstask .dcs-deliv .dp{font-family:monospace;font-size:11px;opacity:.7;word-break:break-all}" +
    ".dcstask .dcs-deliv .dd{font-size:11.5px;opacity:.65;width:100%}" +
    ".dcstask .dcs-out{font-family:monospace;font-size:11.5px;opacity:.7;margin-top:2px}" +
    ".dcsset input[type=text],.dcsset input[type=password]{width:100%;padding:6px 8px;border-radius:6px;border:1px solid rgba(128,128,128,.45);background:transparent;color:inherit;box-sizing:border-box;margin:2px 0 4px}" +
    ".dcsset label{display:block;font-size:12px;opacity:.78;margin:10px 0 2px}" +
    ".dcsset button{padding:6px 14px;border-radius:6px;border:1px solid rgba(128,128,128,.5);background:transparent;color:inherit;cursor:pointer;margin-right:8px}" +
    ".dcsset button.dcs-primary{background:#0f62fe;border-color:#0f62fe;color:#fff}" +
    ".dcsset button:disabled{opacity:.5;cursor:default}" +
    ".dcsset .dcs-row{display:flex;align-items:center;gap:8px;margin:12px 0 4px;flex-wrap:wrap}" +
    ".dcsset .dcs-status{font-size:12px;opacity:.85;margin-top:10px;white-space:pre-wrap}" +
    ".dcsset .dcs-desc{font-size:12px;opacity:.7;line-height:1.6;border-left:3px solid rgba(128,128,128,.4);padding-left:8px;margin-bottom:6px}";
  document.head.appendChild(style);
}

var STATUS_LABEL = { pending: "待执行", running: "进行中", done: "已完成", failed: "失败", blocked: "受阻" };

function api(path) {
  return fetch("/api/dcs-cloud" + path).then(function (r) {
    return r.json();
  });
}

var DELIV_TYPE_LABEL = { dataset: "数据集", result: "结果", chart: "图表", report: "报告", file: "文件" };

function StepItem(props) {
  var step = props.step; var stepsMap = props.stepsMap;
  var openState = React.useState(false);
  var open = openState[0]; var setOpen = openState[1];
  var deps = (step.dependsOn || []).map(function (d) { return stepsMap[d] ? stepsMap[d].title : d; });
  var dels = step.deliverables || [];
  // 交付物分组：数据集 vs 结果（result/chart/report/file 归为结果类）
  var datasets = dels.filter(function (d) { return d.type === "dataset"; });
  var results = dels.filter(function (d) { return d.type !== "dataset"; });

  function delivRow(d) {
    return h("div", { key: d.name + d.path, className: "dcs-deliv" },
      h("span", { className: "db " + d.type }, DELIV_TYPE_LABEL[d.type] || d.type),
      h("span", { className: "dn" }, d.name),
      d.path ? h("span", { className: "dp" }, d.path) : null,
      d.desc ? h("div", { className: "dd" }, d.desc) : null
    );
  }

  var body = open ? h("div", null,
    step.detail ? h("div", { className: "dcs-detail" }, step.detail) : null,
    deps.length ? h("div", { className: "dcs-deps" }, h("b", null, "依赖 → "), deps.join(" → ")) : null,
    dels.length ? h("div", { className: "dcs-delivs" },
      datasets.length ? h("div", null, h("div", { className: "dh" }, "数据集"), datasets.map(delivRow)) : null,
      results.length ? h("div", null, h("div", { className: "dh" }, "结果"), results.map(delivRow)) : null
    ) : null
  ) : null;

  return h("div", { key: step.id, className: "dcs-step " + step.status },
    h("div", { className: "row dcs-step-head", onClick: function () { setOpen(!open); } },
      h("span", { className: "dcs-chevron" + (open ? " open" : "") }, "▸"),
      h("span", { className: "dcs-badge " + step.status }, STATUS_LABEL[step.status] || step.status),
      h("span", { className: "t" }, step.title),
      h("span", { style: { opacity: .55, fontSize: 12 } }, step.progress + "%" + (dels.length ? " · " + dels.length + " 交付物" : ""))
    ),
    h("div", { className: "dcs-bar" }, h("div", { className: "fill " + step.status, style: { width: step.progress + "%" } })),
    body
  );
}

function statusClass(s) {
  var x = String(s || "");
  if (/完成|成功|done|completed|finish/i.test(x)) return "done";
  if (/运行|进行|running|running/i.test(x)) return "running";
  if (/失败|错误|fail|error/i.test(x)) return "failed";
  if (/取消|受阻|blocked|cancel/i.test(x)) return "blocked";
  return "pending";
}

function TaskDetail(task, models, onModelChange) {
  if (!task) return h("div", { className: "dcs-empty" }, "暂无任务详情");
  var stepsMap = {};
  (task.steps || []).forEach(function (s) { stepsMap[s.id] = s; });
  var done = (task.steps || []).filter(function (s) { return s.status === "done"; }).length;
  var total = (task.steps || []).length;
  var modelOpts = (models || [{ id: "auto", label: "自动选择" }]).map(function (m) {
    return h("option", { key: m.id, value: m.id }, m.label);
  });
  return h("div", null,
    h("div", { className: "dcs-head" },
      h("div", { className: "dcs-title" }, task.title),
      h("span", { style: { opacity: .6, fontSize: 12 } }, "进度 " + done + "/" + total + " 步")
    ),
    task.objective ? h("div", { className: "dcs-obj" }, "目标：" + task.objective) : null,

    h("div", { style: { display: "flex", alignItems: "center", gap: 10, margin: "10px 0", flexWrap: "wrap" } },
      h("label", { style: { fontSize: 12, opacity: .75 } }, "模型"),
      h("select", {
        value: task.model || "auto",
        onChange: function (e) { if (onModelChange) onModelChange(task.id, e.target.value); },
        style: { padding: "5px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,.45)", background: "transparent", color: "inherit", fontSize: 13 },
      }, modelOpts),
      task.resources ? h("span", { style: { fontSize: 12, opacity: .6 } }, "资源：" + task.resources) : null
    ),

    h("h3", null, "数据源"),
    h("div", { className: "dcs-card" },
      (task.dataSources && task.dataSources.length)
        ? task.dataSources.map(function (s, i) {
            return h("div", { key: i, className: "dcs-src" },
              h("span", { className: "n" }, s.name),
              s.path ? h("span", { className: "p" }, s.path) : null,
              s.type ? h("span", { style: { opacity: .6, fontSize: 12 } }, s.type) : null
            );
          })
        : h("span", { style: { opacity: .6 } }, "（未记录）")
    ),

    h("h3", null, "分析步骤与逻辑关系"),
    h("div", null,
      (task.steps && task.steps.length)
        ? task.steps.map(function (s) { return h(StepItem, { key: s.id, step: s, stepsMap: stepsMap }); })
        : h("div", { className: "dcs-empty" }, "暂无步骤，开始分析后这里显示每步计划、依赖关系与进展")
    )
  );
}

function OfflineSection(offline) {
  var tasks = (offline && offline.tasks) || [];
  return h("div", null,
    h("h3", null, "离线任务与资源消耗"),
    tasks.length
      ? tasks.map(function (t) {
          return h("div", { key: t.id, className: "dcs-card" },
            h("div", { className: "dcs-head" },
              h("span", { style: { fontWeight: 600, fontSize: 14 } }, t.name),
              t.createTime ? h("span", { style: { opacity: .55, fontSize: 12 } }, t.createTime) : null
            ),
            (t.subtasks && t.subtasks.length)
              ? t.subtasks.map(function (s) {
                  return h("div", { key: s.id, style: { padding: "4px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } },
                    h("span", { className: "dcs-badge " + statusClass(s.status) }, s.status || "未知"),
                    s.resource ? h("span", { style: { fontSize: 12, opacity: .75 } }, s.resource) : null,
                    s.amount ? h("span", { style: { fontSize: 12, opacity: .6 } }, "费用 " + s.amount) : null,
                    s.image ? h("span", { style: { fontSize: 11, opacity: .5, fontFamily: "monospace" } }, s.image) : null
                  );
                })
              : h("div", { style: { opacity: .6, fontSize: 12 } }, "（无子任务详情）")
          );
        })
      : h("div", { className: "dcs-empty" }, "暂无离线任务。长任务投递后会在这里显示状态与资源消耗。")
  );
}

function DcsTaskView(props) {
  var sessionId = props && props.sessionId ? props.sessionId : "";
  var tasksState = React.useState([]); var tasks = tasksState[0]; var setTasks = tasksState[1];
  var selState = React.useState(null); var sel = selState[0]; var setSel = selState[1];
  var errState = React.useState(""); var err = errState[0]; var setErr = errState[1];
  var modelsState = React.useState([{ id: "auto", label: "自动选择" }]); var models = modelsState[0]; var setModels = modelsState[1];
  var offlineState = React.useState({ tasks: [] }); var offline = offlineState[0]; var setOffline = offlineState[1];

  React.useEffect(function () {
    var live = true;
    function load() {
      api("/tasks?sessionId=" + encodeURIComponent(sessionId)).then(function (d) {
        if (!live) return;
        if (d && d.ok) {
          setTasks(d.tasks || []);
          setErr("");
          setSel(function (cur) {
            if (cur && d.tasks.some(function (t) { return t.id === cur; })) return cur;
            return d.tasks.length ? d.tasks[0].id : null;
          });
        } else {
          setErr((d && d.error) || "读取失败");
        }
      }).catch(function (e) { if (live) setErr(String(e && e.message || e)); });
      api("/offline-tasks").then(function (d) {
        if (live && d && d.ok) setOffline({ tasks: d.tasks || [] });
      }).catch(function () {});
    }
    api("/models").then(function (d) { if (live && d && d.ok && d.models) setModels(d.models); }).catch(function () {});
    load();
    var timer = setInterval(load, 5000);
    return function () { live = false; clearInterval(timer); };
  }, [sessionId]);

  var task = tasks.find(function (t) { return t.id === sel; }) || null;

  function changeModel(taskId, model) {
    apiPost("/tasks/" + encodeURIComponent(taskId), { model: model }).then(function (d) {
      if (d && d.ok && d.task) {
        setTasks(function (cur) { return cur.map(function (t) { return t.id === d.task.id ? d.task : t; }); });
      }
    }).catch(function () {});
  }

  return h("div", { className: "dcstask" },
    h("div", { className: "dcs-head" },
      h("h2", null, "DCS 任务"),
      h("button", { className: "dcs-refresh", onClick: function () { api("/tasks?sessionId=" + encodeURIComponent(sessionId)).then(function (d) { if (d && d.ok) setTasks(d.tasks || []); }); } }, "刷新")
    ),
    err ? h("div", { style: { color: "#e5484d", fontSize: 12 } }, err) : null,

    tasks.length
      ? h("div", { className: "dcs-tasks" },
          tasks.map(function (t) {
            return h("button", {
              key: t.id, className: "dcs-tchip" + (t.id === sel ? " on" : ""),
              onClick: function () { setSel(t.id); },
            }, t.title);
          })
        )
      : h("div", { className: "dcs-empty" },
          "本会话暂无 DCS 任务。开始分析后，agent 会用 dcs_task_update 把分析计划、数据源、步骤逻辑与进展写到这里。"
        ),

    h("div", { style: { marginTop: 8 } }, TaskDetail(task, models, changeModel)),
    h("div", { style: { marginTop: 8 } }, OfflineSection(offline))
  );
}

function apiPost(path, body) {
  return fetch("/api/dcs-cloud" + path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }).then(function (r) { return r.json(); });
}

function DcsCloudSettingsPage() {
  var patState = React.useState(""); var pat = patState[0]; var setPat = patState[1];
  var cliState = React.useState(""); var cliPath = cliState[0]; var setCliPath = cliState[1];
  var autoState = React.useState("auto"); var autoInstall = autoState[0]; var setAutoInstall = autoState[1];
  var statusState = React.useState("加载中…"); var status = statusState[0]; var setStatus = statusState[1];
  var busyState = React.useState(false); var busy = busyState[0]; var setBusy = busyState[1];

  React.useEffect(function () {
    api("/config").then(function (c) {
      if (!c || !c.ok) { setStatus("读取配置失败: " + ((c && c.error) || "")); return; }
      if (c.cliPath) setCliPath(c.cliPath === "dcs" ? "" : c.cliPath);
      if (c.autoInstall) setAutoInstall(c.autoInstall);
      var s = c.status || {};
      setStatus(c.patSet
        ? ("已配置 PAT（…" + c.patHint.slice(-4) + "）" + (s.loggedIn ? "｜已登录 " + (s.username || "") + "｜" + (s.region || "") + "｜项目 " + (s.project || "") : "｜未登录"))
        : "尚未配置 PAT。填入 DCS Cloud 个人访问令牌（dcs_pat_...）后点「保存并登录」。");
    }).catch(function (e) { setStatus("读取配置失败: " + String(e)); });
  }, []);

  function save() {
    setBusy(true);
    apiPost("/config", { pat: pat, cliPath: cliPath, autoInstall: autoInstall }).then(function (r) {
      if (r && r.ok) {
        var s = r.status || {};
        setStatus((s.loggedIn ? "✅ 已登录 " + (s.username || "") + "｜" + (s.region || "") + "｜项目 " + (s.project || "") : "⚠️ PAT 已保存，但登录未成功（请检查 PAT 是否有效）"));
      } else {
        setStatus("❌ 保存失败: " + ((r && r.error) || ""));
      }
    }).catch(function (e) { setStatus("❌ 保存失败: " + String(e)); }).finally(function () { setBusy(false); });
  }

  function test() {
    setBusy(true);
    apiPost("/test").then(function (r) {
      var s = (r && r.status) || {};
      setStatus(s.loggedIn ? ("✅ 连接正常：" + (s.username || "") + "｜" + (s.region || "") + "｜项目 " + (s.project || "")) : "❌ 未登录 / 连接失败");
    }).catch(function (e) { setStatus("❌ 测试失败: " + String(e)); }).finally(function () { setBusy(false); });
  }

  return h("div", { className: "dcsset" },
    h("div", { className: "dcs-desc" },
      "配置 DCS Cloud 访问令牌（PAT），用于登录 dcs CLI 与检索公共库。获取方式：登录 DCS Cloud →「个人中心 → API Key / PAT 管理」创建，形如 dcs_pat_...。Genpilot LLM 与 Genos 模型为系统自带、无需额外 key。"
    ),
    h("label", null, "个人访问令牌 (PAT)"),
    h("input", { type: "password", value: pat, placeholder: "dcs_pat_...（留空保存 = 保留已保存的 PAT）", onChange: function (e) { setPat(e.target.value); } }),
    h("label", null, "dcs CLI 路径（可选）"),
    h("input", { type: "text", value: cliPath, placeholder: "留空 = 自动在 PATH 中查找 / 自动下载", onChange: function (e) { setCliPath(e.target.value); } }),
    h("label", null, "二进制自动安装"),
    h("select", { value: autoInstall, onChange: function (e) { setAutoInstall(e.target.value); }, style: { padding: "6px 8px", borderRadius: 6, border: "1px solid rgba(128,128,128,.45)", background: "transparent", color: "inherit" } },
      h("option", { value: "auto" }, "auto — 找不到时自动下载（含 SHA256 校验）"),
      h("option", { value: "never" }, "never — 只用已有二进制")
    ),
    h("div", { className: "dcs-row" },
      h("button", { className: "dcs-primary", disabled: busy, onClick: save }, busy ? "处理中…" : "保存并登录"),
      h("button", { disabled: busy, onClick: test }, "测试连接")
    ),
    h("div", { className: "dcs-status" }, status)
  );
}

function apply(ctx) {
  injectCss();
  ctx.slots.inject(
    "conversation.view",
    function () {
      return ctx.slots.register(
        { name: "conversation.view", id: "dcs-task", order: 50, label: "DCS 任务" },
        DcsTaskView
      );
    }
  );
  ctx.slots.inject(
    "settings.section",
    function () {
      return ctx.slots.register(
        { name: "settings.section", id: "dcs-cloud", order: 31, label: "DCS Cloud" },
        DcsCloudSettingsPage
      );
    }
  );
}

module.exports = {
  apply: apply,
  inject: ["slots"]
};
return module.exports; } });
