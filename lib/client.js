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
    ".dcstask .dcs-step .t{font-weight:600}" +
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
    ".dcstask .dcs-out{font-family:monospace;font-size:11.5px;opacity:.7;margin-top:2px}";
  document.head.appendChild(style);
}

var STATUS_LABEL = { pending: "待执行", running: "进行中", done: "已完成", failed: "失败", blocked: "受阻" };

function api(path) {
  return fetch("/api/dcs-cloud" + path).then(function (r) {
    return r.json();
  });
}

function StepItem(step, stepsMap) {
  var deps = (step.dependsOn || []).map(function (d) { return stepsMap[d] ? stepsMap[d].title : d; });
  return h("div", { key: step.id, className: "dcs-step " + step.status },
    h("div", { className: "row" },
      h("span", { className: "dcs-badge " + step.status }, STATUS_LABEL[step.status] || step.status),
      h("span", { className: "t" }, step.title),
      h("span", { style: { opacity: .55, fontSize: 12 } }, step.progress + "%")
    ),
    step.detail ? h("div", { className: "dcs-detail" }, step.detail) : null,
    deps.length ? h("div", { className: "dcs-deps" }, h("b", null, "依赖 → "), deps.join(" → ")) : null,
    step.outputs && step.outputs.length ? h("div", { className: "dcs-out" }, "输出: " + step.outputs.join(", ")) : null,
    h("div", { className: "dcs-bar" }, h("div", { className: "fill " + step.status, style: { width: step.progress + "%" } }))
  );
}

function TaskDetail(task) {
  if (!task) return h("div", { className: "dcs-empty" }, "暂无任务详情");
  var stepsMap = {};
  (task.steps || []).forEach(function (s) { stepsMap[s.id] = s; });
  var done = (task.steps || []).filter(function (s) { return s.status === "done"; }).length;
  var total = (task.steps || []).length;
  return h("div", null,
    h("div", { className: "dcs-head" },
      h("div", { className: "dcs-title" }, task.title),
      h("span", { style: { opacity: .6, fontSize: 12 } }, "进度 " + done + "/" + total + " 步")
    ),
    task.objective ? h("div", { className: "dcs-obj" }, "目标：" + task.objective) : null,

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
        ? task.steps.map(function (s) { return StepItem(s, stepsMap); })
        : h("div", { className: "dcs-empty" }, "暂无步骤，开始分析后这里显示每步计划、依赖关系与进展")
    )
  );
}

function DcsTaskView() {
  var tasksState = React.useState([]); var tasks = tasksState[0]; var setTasks = tasksState[1];
  var selState = React.useState(null); var sel = selState[0]; var setSel = selState[1];
  var errState = React.useState(""); var err = errState[0]; var setErr = errState[1];

  React.useEffect(function () {
    var live = true;
    function load() {
      api("/tasks").then(function (d) {
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
    }
    load();
    var timer = setInterval(load, 5000);
    return function () { live = false; clearInterval(timer); };
  }, []);

  var task = tasks.find(function (t) { return t.id === sel; }) || null;

  return h("div", { className: "dcstask" },
    h("div", { className: "dcs-head" },
      h("h2", null, "DCS 任务"),
      h("button", { className: "dcs-refresh", onClick: function () { api("/tasks").then(function (d) { if (d && d.ok) setTasks(d.tasks || []); }); } }, "刷新")
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
          "暂无 DCS 任务。开始分析后，agent 会用 dcs_task_update 把分析计划、数据源、步骤逻辑与进展写到这里。"
        ),

    h("div", { style: { marginTop: 8 } }, TaskDetail(task))
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
}

module.exports = {
  apply: apply,
  inject: ["slots"]
};
return module.exports; } });
