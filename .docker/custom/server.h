#include <libwebsockets.h>
#include <stdbool.h>
#include <uv.h>

#include "pty.h"

// client message
#define INPUT '0'
#define RESIZE_TERMINAL '1'
#define PAUSE '2'
#define RESUME '3'
#define JSON_DATA '{'

// server message
#define OUTPUT '0'
#define SET_WINDOW_TITLE '1'
#define SET_PREFERENCES '2'

// Workspace heartbeat helpers
void setup_workspace_heartbeat(uv_loop_t* loop);
void cleanup_workspace_heartbeat(void);
void workspace_heartbeat_note_activity(void);

// url paths
struct endpoints {
  char *ws;
  char *index;
  char *token;
  char *parent;
};

extern volatile bool force_exit;
extern struct lws_context *context;
extern struct lws_vhost *vhost;
extern struct server *server;
extern struct endpoints endpoints;

struct pss_http {
  char path[128];
  char *buffer;
  char *ptr;
  size_t len;
  char *post_body;      // Buffer for POST body
  size_t post_body_len; // Length of POST body received
  size_t post_body_max; // Max size allocated for POST body
};

struct pss_tty {
  bool initialized;
  int initial_cmd_index;
  bool authenticated;
  char user[30];
  char address[50];
  char path[128];
  char **args;
  int argc;

  struct lws *wsi;
  char *buffer;
  size_t len;

  pty_process *process;
  pty_buf_t *pty_buf;

  int lws_close_status;
};

typedef struct {
  struct pss_tty *pss;
  bool ws_closed;
} pty_ctx_t;

struct server {
  int client_count;        // client count
  char *prefs_json;        // client preferences
  char *credential;        // encoded basic auth credential
  char *auth_header;       // header name used for auth proxy
  char *index;             // custom index.html
  char *command;           // full command line
  char **argv;             // command with arguments
  int argc;                // command + arguments count
  char *cwd;               // working directory
  int sig_code;            // close signal
  char sig_name[20];       // human readable signal string
  bool url_arg;            // allow client to send cli arguments in URL
  bool writable;           // whether clients to write to the TTY
  bool check_origin;       // whether allow websocket connection from different origin
  int max_clients;         // maximum clients to support
  bool once;               // whether accept only one client and exit on disconnection
  bool exit_no_conn;       // whether exit on all clients disconnection
  char socket_path[255];   // UNIX domain socket path
  char terminal_type[30];  // terminal type to report

  uv_loop_t *loop;         // the libuv event loop
};
